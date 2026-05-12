const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

let authBindings = {
  getAuthState: () => null,
  updateAuthState: () => {},
  clearAuthState: () => {}
};

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export function bindAuthHandlers(bindings) {
  authBindings = {
    ...authBindings,
    ...bindings
  };
}

function buildHeaders(customHeaders = {}) {
  const authState = authBindings.getAuthState();
  const headers = {
    Accept: "application/json",
    ...customHeaders
  };

  if (authState?.accessToken) {
    headers.Authorization = `Bearer ${authState.accessToken}`;
  }

  return headers;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    return text ? { message: text } : null;
  }

  return response.json();
}

async function refreshSession() {
  const authState = authBindings.getAuthState();

  if (!authState?.refreshToken) {
    return null;
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      refreshToken: authState.refreshToken
    })
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    authBindings.clearAuthState();
    throw new ApiError(data?.message || "Session refresh failed", response.status, data);
  }

  authBindings.updateAuthState(data);
  return data;
}

export async function refreshAuthSession() {
  return refreshSession();
}

export async function apiRequest(path, options = {}, retry = true) {
  const { body, headers, ...rest } = options;
  const requestHeaders = buildHeaders(headers);
  const requestOptions = {
    ...rest,
    headers: requestHeaders
  };

  if (body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, requestOptions);

  if (response.status === 401 && retry) {
    const isRefreshCall = path === "/api/v1/auth/refresh";
    const isLoginCall = path === "/api/v1/auth/login";

    if (!isRefreshCall && !isLoginCall) {
      await refreshSession();
      return apiRequest(path, options, false);
    }
  }

  const data = await parseResponse(response);

  if (!response.ok) {
    throw new ApiError(data?.message || "Request failed", response.status, data);
  }

  return data;
}

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

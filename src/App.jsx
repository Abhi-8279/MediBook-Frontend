import React, {
  createContext,
  useContext,
  useDeferredValue,
  useEffect,
  useRef,
  useState
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { ApiError, apiRequest, apiUrl, bindAuthHandlers, refreshAuthSession } from "./api";

const AuthContext = createContext(null);
const POST_OAUTH_REDIRECT_KEY = "medibook-post-oauth-redirect";

const PAYMENT_MODES = ["CARD", "UPI", "WALLET", "CASH"];
const ONLINE_PAYMENT_MODES = ["CARD", "UPI", "WALLET"];
const PAYMENT_STATUSES = ["PENDING", "PAID", "REFUNDED", "FAILED"];
const CONSULTATION_MODES = ["IN_PERSON", "TELECONSULTATION"];
const NOTIFICATION_CHANNELS = ["APP", "EMAIL", "SMS"];
const NOTIFICATION_TYPES = ["BOOKING", "REMINDER", "CANCELLATION", "PAYMENT", "FOLLOWUP", "BROADCAST", "SECURITY"];
const BROADCAST_AUDIENCES = ["ALL", "PATIENT", "PROVIDER"];
const APPOINTMENT_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"];
const RECURRENCE_TYPES = ["DAILY", "WEEKLY", "CUSTOM"];
const DAYS_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY"
];
const SPECIALIZATION_OPTIONS = [
  "Cardiologist",
  "Dentist",
  "Dental Surgeon",
  "Dermatologist",
  "ENT Specialist",
  "General Physician",
  "Gynecologist",
  "Neurologist",
  "Oncologist",
  "Ophthalmologist",
  "Orthopedic",
  "Pediatrician",
  "Psychiatrist",
  "Pulmonologist",
  "Urologist"
];
const QUALIFICATION_OPTIONS = [
  "MBBS",
  "BDS",
  "BHMS",
  "BAMS",
  "BUMS",
  "MD",
  "MS",
  "DM Cardiology",
  "MCh",
  "DNB",
  "MDS",
  "BPT",
  "MPT",
  "PhD Clinical Psychology",
  "MPH"
];
const FOOTER_SERVICE_ITEMS = [
  {
    mark: "RX",
    title: "Trusted Meds",
    description: "Prescription support, refill-friendly notes, and cleaner medication follow-up."
  },
  {
    mark: "LAB",
    title: "Diagnostics",
    description: "Lab-ready care journeys with records, invoices, and visit context in one place."
  },
  {
    mark: "DENT",
    title: "Dental Care",
    description: "From checkups to specialist bookings, dental visits stay easy to track."
  },
  {
    mark: "24/7",
    title: "Teleconsults",
    description: "Online appointments, reminders, and post-visit follow-up without the clutter."
  }
];
const FOOTER_TRUST_BADGES = [
  { mark: "SEC", label: "Secure payments" },
  { mark: "DOC", label: "Verified providers" },
  { mark: "REC", label: "Medical records" },
  { mark: "SUP", label: "Follow-up support" }
];
const RAZORPAY_CHECKOUT_URL =
  import.meta.env.VITE_RAZORPAY_CHECKOUT_URL || "https://checkout.razorpay.com/v1/checkout.js";

let razorpayScriptPromise = null;

function useAuth() {
  return useContext(AuthContext);
}

function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (state === null || state === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(state));
      }
    } catch (error) {
      // Ignore localStorage persistence issues to keep the app usable.
    }
  }, [key, state]);

  return [state, setState];
}

function normalizeAuthResponse(response) {
  if (!response) {
    return null;
  }

  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    tokenType: response.tokenType,
    expiresIn: response.expiresIn,
    user: response.user
  };
}

function storePostOAuthRedirect(destination) {
  try {
    window.sessionStorage.setItem(POST_OAUTH_REDIRECT_KEY, destination || "/dashboard");
  } catch (error) {
    // Ignore sessionStorage issues and fall back to the default destination later.
  }
}

function consumePostOAuthRedirect() {
  try {
    const destination = window.sessionStorage.getItem(POST_OAUTH_REDIRECT_KEY);
    window.sessionStorage.removeItem(POST_OAUTH_REDIRECT_KEY);
    return destination || "/dashboard";
  } catch (error) {
    return "/dashboard";
  }
}

function buildQuery(params) {
  const query = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      (typeof value === "boolean" && value === false)
    ) {
      return;
    }

    query.set(key, String(value));
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

function getErrorMessage(error) {
  if (!error) {
    return "Something went wrong.";
  }

  if (error instanceof ApiError) {
    const detail = Array.isArray(error.data?.details) && error.data.details.length > 0
      ? ` (${error.data.details[0]})`
      : "";
    return error.data?.message || error.data?.error || `${error.message}${detail}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

function isOnlinePaymentMode(mode) {
  return ONLINE_PAYMENT_MODES.includes(mode);
}

function formatRazorpayContact(phone) {
  if (!phone) {
    return undefined;
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return undefined;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }

  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  return `+${digits}`;
}

function loadRazorpayCheckoutScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay checkout is only available in the browser."));
  }

  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }

  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = RAZORPAY_CHECKOUT_URL;
      script.async = true;
      script.onload = () => resolve(window.Razorpay);
      script.onerror = () => {
        razorpayScriptPromise = null;
        reject(new Error("Unable to load Razorpay Checkout right now."));
      };
      document.body.appendChild(script);
    });
  }

  return razorpayScriptPromise;
}

async function startPatientCheckoutPayment({ appointmentId, amount, mode, notes, authUser }) {
  const normalizedMode = mode || "CARD";
  const normalizedAmount = Number(amount);

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error("Enter a valid payment amount before continuing.");
  }

  if (!isOnlinePaymentMode(normalizedMode)) {
    return apiRequest("/api/v1/payments/process", {
      method: "POST",
      body: {
        appointmentId,
        amount: normalizedAmount,
        mode: "CASH",
        currency: "INR",
        notes: notes || null
      }
    });
  }

  await loadRazorpayCheckoutScript();

  const checkoutOrder = await apiRequest("/api/v1/payments/checkout/order", {
    method: "POST",
    body: {
      appointmentId,
      amount: normalizedAmount,
      mode: normalizedMode,
      currency: "INR",
      notes: notes || null
    }
  });

  if (!window.Razorpay) {
    throw new Error("Razorpay checkout could not be initialized.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    async function markFailure(reason, razorpayPaymentId = null, razorpayOrderId = checkoutOrder.razorpayOrderId) {
      try {
        await apiRequest("/api/v1/payments/checkout/failure", {
          method: "POST",
          body: {
            paymentId: checkoutOrder.paymentId,
            razorpayOrderId,
            razorpayPaymentId,
            reason
          }
        });
      } catch (error) {
        // Checkout failure should not block the patient from seeing the original error state.
      }
    }

    const razorpay = new window.Razorpay({
      key: checkoutOrder.keyId,
      amount: checkoutOrder.amountInSubunits,
      currency: checkoutOrder.currency,
      name: checkoutOrder.businessName,
      description: checkoutOrder.description,
      image: checkoutOrder.imageUrl || undefined,
      order_id: checkoutOrder.razorpayOrderId,
      handler: async (response) => {
        if (settled) {
          return;
        }

        settled = true;

        try {
          const verifiedPayment = await apiRequest("/api/v1/payments/checkout/confirm", {
            method: "POST",
            body: {
              paymentId: checkoutOrder.paymentId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature
            }
          });
          resolve(verifiedPayment);
        } catch (error) {
          reject(error);
        }
      },
      prefill: {
        name: authUser?.fullName || undefined,
        email: authUser?.email || undefined,
        contact: formatRazorpayContact(authUser?.phone)
      },
      notes: {
        appointmentId: checkoutOrder.appointmentId,
        paymentId: checkoutOrder.paymentId
      },
      theme: {
        color: "#0f766e"
      },
      modal: {
        ondismiss: async () => {
          if (settled) {
            return;
          }

          settled = true;
          await markFailure("Checkout dismissed by patient");
          reject(new Error("Payment was cancelled before completion."));
        }
      }
    });

    razorpay.on("payment.failed", async (response) => {
      if (settled) {
        return;
      }

      settled = true;
      await markFailure(
        response?.error?.description || response?.error?.reason || "Razorpay payment failed",
        response?.error?.metadata?.payment_id || null,
        response?.error?.metadata?.order_id || checkoutOrder.razorpayOrderId
      );
      reject(new Error(response?.error?.description || "Payment failed. Please try again."));
    });

    razorpay.open();
  });
}

function formatEnum(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatDate(value) {
  if (!value) {
    return "â€”";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatTime(value) {
  if (!value) {
    return "â€”";
  }

  return value.slice(0, 5);
}

function formatInstant(value) {
  if (!value) {
    return "â€”";
  }

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCurrency(value, currency = "INR") {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency
  }).format(Number.isFinite(amount) ? amount : 0);
}

function defaultDate(offsetDays = 0) {
  const today = new Date();
  today.setDate(today.getDate() + offsetDays);
  return today.toISOString().slice(0, 10);
}

function normalizeResourceData(initialData, result) {
  if (Array.isArray(initialData)) {
    return Array.isArray(result) ? result : initialData;
  }

  if (initialData && typeof initialData === "object" && !Array.isArray(initialData)) {
    return result && typeof result === "object" && !Array.isArray(result) ? result : initialData;
  }

  return result ?? initialData;
}

function useApiResource(initialData, dependencies, loader) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await loader();
        if (active) {
          setData(normalizeResourceData(initialData, result));
        }
      } catch (loadError) {
        if (active) {
          setError(getErrorMessage(loadError));
          setData(initialData);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, dependencies);

  return { data, setData, loading, error };
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("MediBook frontend crashed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page-stack">
          <section className="section-card">
            <div className="section-head">
              <div>
                <h2>Something Broke On This Screen</h2>
                <p>
                  The dashboard hit a frontend runtime error. Refresh once after the latest changes, and if it
                  still appears, the exact message is shown below instead of a blank page.
                </p>
              </div>
            </div>
            <div className="state-box state-error">
              {this.state.error?.message || "Unexpected frontend error."}
            </div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function statusTone(value) {
  const token = String(value || "").toUpperCase();

  if (token.includes("PAID") || token.includes("COMPLETED") || token.includes("VERIFIED") || token === "ACTIVE") {
    return "success";
  }

  if (token.includes("PENDING") || token.includes("BOOKING") || token.includes("SCHEDULED")) {
    return "warning";
  }

  if (token.includes("REFUNDED") || token.includes("CANCELLED") || token.includes("FAILED") || token === "INACTIVE") {
    return "danger";
  }

  return "neutral";
}

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function SectionCard({ title, subtitle, actions, children, className, headingClassName }) {
  return (
    <section className={classNames("section-card", className)}>
      <div className={classNames("section-head", headingClassName)}>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function StatCard({ label, value, tone = "neutral" }) {
  return (
    <article className={classNames("stat-card", `tone-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DataState({ loading, error, data, emptyMessage, children }) {
  const hasNoData =
    Array.isArray(data) ? data.length === 0 : data === null || data === undefined || data === "";

  if (loading) {
    return <div className="state-box">Loading...</div>;
  }

  if (error) {
    return <div className="state-box state-error">{error}</div>;
  }

  if (hasNoData) {
    return <div className="state-box">{emptyMessage}</div>;
  }

  return children;
}

function Tabs({ items, activeKey, onChange }) {
  return (
    <div className="tabs">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={classNames("tab-button", item.key === activeKey && "is-active")}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function NotificationFeed({
  notifications,
  loading,
  error,
  onRead,
  onDelete,
  onReadAll
}) {
  return (
    <SectionCard
      title="Notifications"
      subtitle="Stay on top of booking updates, reminders, and system events."
      actions={
        <button type="button" className="button ghost" onClick={onReadAll}>
          Mark All Read
        </button>
      }
    >
      <DataState
        loading={loading}
        error={error}
        data={notifications}
        emptyMessage="No notifications yet."
      >
        <div className="stack-list">
          {notifications.map((notification) => (
            <article
              key={notification.notificationId}
              className={classNames("info-card", !notification.read && "highlight-card")}
            >
              <div className="meta-row">
                <span className={classNames("pill", `pill-${statusTone(notification.read ? "READ" : "UNREAD")}`)}>
                  {notification.read ? "Read" : "Unread"}
                </span>
                <span className="pill pill-neutral">{formatEnum(notification.type)}</span>
                <span className="muted">{formatInstant(notification.sentAt)}</span>
              </div>
              <h3>{notification.title}</h3>
              <p>{notification.message}</p>
              <div className="meta-row">
                <span className="muted">
                  {formatEnum(notification.channel)}
                  {notification.relatedType ? ` â€¢ ${formatEnum(notification.relatedType)}` : ""}
                </span>
                <div className="row-actions">
                  {!notification.read ? (
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => onRead(notification.notificationId)}
                    >
                      Mark Read
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button ghost danger"
                    onClick={() => onDelete(notification.notificationId)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </DataState>
    </SectionCard>
  );
}

function ProtectedRoute({ children }) {
  const auth = useAuth();
  const location = useLocation();

  if (!auth.ready) {
    return (
      <div className="page-stack">
        <section className="section-card">
          <div className="state-box">Restoring your session...</div>
        </section>
      </div>
    );
  }

  if (!auth.user) {
    return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />;
  }

  return children;
}

function AppShell({ children, notice, onClearNotice, themeMode, onToggleTheme }) {
  const auth = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await auth.logout();
    navigate("/");
  }

  return (
    <div className="app-shell">
      <div className="background-orb background-a" />
      <div className="background-orb background-b" />
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">M</span>
          <span>
            <strong>MediBook</strong>
            <small>Book smarter. Heal faster.</small>
          </span>
        </Link>
        <nav className="topnav">
          <NavLink to="/">Home</NavLink>
          {auth.user ? <NavLink to="/dashboard">Dashboard</NavLink> : null}
          {auth.user ? <NavLink to="/profile">Profile</NavLink> : null}
          {!auth.user ? <NavLink to="/auth">Login / Register</NavLink> : null}
        </nav>
        <div className="topbar-side">
          <button type="button" className="theme-toggle" onClick={onToggleTheme} aria-label="Toggle color theme">
            <span className={classNames("theme-toggle-indicator", themeMode === "dark" && "is-dark")} />
            <span className="theme-toggle-label">{themeMode === "dark" ? "Dark mode" : "Light mode"}</span>
          </button>
          {auth.user ? (
            <>
              <span className="user-chip">
                {auth.user.fullName}
                <small>{formatEnum(auth.user.role)}</small>
              </span>
              <button type="button" className="button ghost" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <Link to="/auth" className="button primary">
              Get Started
            </Link>
          )}
        </div>
      </header>
      {notice ? (
        <div className="notice-banner">
          <span>{notice.message}</span>
          <button type="button" className="button ghost" onClick={onClearNotice}>
            Dismiss
          </button>
        </div>
      ) : null}
      <main className="page">{children}</main>
      <SiteFooterShowcase />
    </div>
  );
}

function SiteFooterShowcase() {
  return (
    <footer className="app-footer">
      <section className="footer-showcase">
        <div className="footer-showcase-copy">
          <span className="eyebrow">Medical Services</span>
          <h2>All major care touchpoints, trusted meds, and secure booking in one place.</h2>
          <p>
            MediBook brings booking, payments, invoices, provider trust, and follow-up care into a
            more reassuring patient experience.
          </p>
        </div>

        <div className="footer-service-grid">
          {FOOTER_SERVICE_ITEMS.map((item) => (
            <article key={item.title} className="footer-service-card">
              <span className="footer-service-mark">{item.mark}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="footer-trust-row">
          {FOOTER_TRUST_BADGES.map((badge) => (
            <div key={badge.label} className="footer-trust-badge">
              <span className="footer-trust-mark">{badge.mark}</span>
              <strong>{badge.label}</strong>
            </div>
          ))}
        </div>
      </section>
    </footer>
  );
}

function AuthPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [oauthRole, setOauthRole] = useState("PATIENT");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [forgotEmail, setForgotEmail] = useState("");
  const [registerForm, setRegisterForm] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    role: "PATIENT",
    profilePicUrl: ""
  });

  const destination = location.state?.from || "/dashboard";

  function handleGoogleLogin() {
    storePostOAuthRedirect(destination);
    window.location.assign(apiUrl(`/oauth2/authorization/google?role=${oauthRole}`));
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await auth.login(loginForm);
      navigate(destination);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await auth.register(registerForm);
      navigate("/dashboard");
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(event) {
    event?.preventDefault?.();
    setForgotLoading(true);
    setError("");
    setForgotMessage("");

    try {
      const response = await apiRequest("/api/v1/auth/forgot-password", {
        method: "POST",
        body: {
          email: forgotEmail
        }
      });
      setForgotMessage(response.message || "If the account exists, a reset link has been sent.");
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div className="auth-grid auth-experience">
      <section className="hero-panel auth-story-panel">
        <div className="auth-story-top">
          <span className="eyebrow auth-story-eyebrow">MediBook Care Flow</span>
          <span className="auth-story-chip">Designed for patients, providers, and support teams</span>
        </div>

        <div className="auth-story-main">
          <div className="auth-story-copy">
            <h1>From search to follow-up, every care step stays organized.</h1>
            <p>
              Discover the right doctor, reserve a consultation, manage schedules, track records, and keep
              communication moving without the usual back-and-forth.
            </p>
          </div>

          <aside className="auth-platform-panel">
            <div className="auth-platform-head">
              <span className="auth-journey-label">Inside the platform</span>
              <h3>Three connected views keep the care journey moving.</h3>
            </div>
            <div className="auth-platform-grid">
              <article className="auth-platform-item">
                <strong>Patient</strong>
                <span>Search, book, pay, and revisit records without jumping between tools.</span>
              </article>
              <article className="auth-platform-item">
                <strong>Provider</strong>
                <span>Publish availability, complete visits, and keep follow-up details in one workspace.</span>
              </article>
              <article className="auth-platform-item">
                <strong>Admin</strong>
                <span>Monitor bookings, provider verification, payments, and notifications across the platform.</span>
              </article>
            </div>
          </aside>
        </div>

        <div className="auth-story-stats">
          <div className="auth-story-stat">
            <strong>Live slots</strong>
            <span>Patients can see real provider availability before they book.</span>
          </div>
          <div className="auth-story-stat">
            <strong>Unified follow-up</strong>
            <span>Payments, reviews, notifications, and records stay linked to the appointment flow.</span>
          </div>
          <div className="auth-story-stat">
            <strong>Clear role workspaces</strong>
            <span>Each role gets a focused dashboard instead of one overloaded screen.</span>
          </div>
        </div>

        <div className="auth-role-showcase">
          <article className="auth-role-card auth-role-card-guest">
            <span className="auth-role-label">Guest</span>
            <h3>Browse first</h3>
            <p>Explore doctors, clinic details, and upcoming slots before creating an account.</p>
          </article>
          <article className="auth-role-card auth-role-card-patient">
            <span className="auth-role-label">Patient</span>
            <h3>Handle your booking journey</h3>
            <p>Reserve appointments, track payments, revisit records, and leave reviews after care.</p>
          </article>
          <article className="auth-role-card auth-role-card-provider">
            <span className="auth-role-label">Provider</span>
            <h3>Run your schedule clearly</h3>
            <p>Publish availability, manage consultations, complete visits, and maintain patient records.</p>
          </article>
        </div>
      </section>

      <section className="section-card auth-card auth-console-card">
        <div className="auth-card-header">
          <div>
            <span className="eyebrow auth-console-eyebrow">
              {mode === "login" ? "Secure Sign In" : "Create Your Account"}
            </span>
            <h2>
              {mode === "login"
                ? "Continue to your MediBook workspace"
                : "Open a patient or provider account in minutes"}
            </h2>
          </div>
          <p>
            {mode === "login"
              ? "Use your email account or continue with Google to pick up where you left off."
              : "Register once to manage appointments, schedules, and care updates from one place."}
          </p>
        </div>

        <Tabs
          items={[
            { key: "login", label: "Login" },
            { key: "register", label: "Register" }
          ]}
          activeKey={mode}
          onChange={setMode}
        />

        {error ? <div className="state-box state-error">{error}</div> : null}

        {mode === "login" ? (
          <>
            <form className="form-grid auth-form-grid" onSubmit={handleLogin}>
              <Field label="Email">
                <input
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                  type="email"
                  placeholder="you@example.com"
                  required
                />
              </Field>
              <Field label="Password">
                <input
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                  type="password"
                  placeholder="Enter your password"
                  required
                />
              </Field>
              <div className="auth-inline-action">
                <button
                  type="button"
                  className="auth-text-button"
                  onClick={() => {
                    setShowForgotPassword((current) => !current);
                    setForgotMessage("");
                    setError("");
                    setForgotEmail((current) => current || loginForm.email);
                  }}
                >
                  {showForgotPassword ? "Hide password reset" : "Forgot password?"}
                </button>
              </div>
              <button type="submit" className="button primary auth-submit-button" disabled={loading}>
                {loading ? "Signing in..." : "Login"}
              </button>
            </form>
            {showForgotPassword ? (
              <form className="auth-forgot-panel" onSubmit={handleForgotPassword}>
                <div className="auth-forgot-head">
                  <strong>Reset your password by email</strong>
                  <span>
                    Enter your login email and we will send a secure password reset link through MediBook
                    notifications.
                  </span>
                </div>
                <div className="auth-forgot-form">
                  <Field label="Account email">
                    <input
                      value={forgotEmail}
                      onChange={(event) => setForgotEmail(event.target.value)}
                      type="email"
                      placeholder="you@example.com"
                      required
                    />
                  </Field>
                  <button type="submit" className="button ghost" disabled={forgotLoading}>
                    {forgotLoading ? "Sending..." : "Send reset link"}
                  </button>
                </div>
                {forgotMessage ? <div className="state-box state-success">{forgotMessage}</div> : null}
              </form>
            ) : null}
          </>
        ) : (
          <form className="form-grid auth-form-grid" onSubmit={handleRegister}>
            <Field label="Full name">
              <input
                value={registerForm.fullName}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, fullName: event.target.value }))
                }
                placeholder="Your full name"
                required
              />
            </Field>
            <Field label="Email">
              <input
                value={registerForm.email}
                onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                type="email"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field label="Password" hint="Minimum 8 characters.">
              <input
                value={registerForm.password}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, password: event.target.value }))
                }
                type="password"
                placeholder="Create a strong password"
                required
              />
            </Field>
            <Field label="Phone">
              <input
                value={registerForm.phone}
                onChange={(event) => setRegisterForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="+91 9876543210"
              />
            </Field>
            <Field label="Role">
              <select
                value={registerForm.role}
                onChange={(event) => setRegisterForm((current) => ({ ...current, role: event.target.value }))}
              >
                <option value="PATIENT">Patient</option>
                <option value="PROVIDER">Provider</option>
              </select>
            </Field>
            <Field label="Profile picture URL">
              <input
                value={registerForm.profilePicUrl}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, profilePicUrl: event.target.value }))
                }
                placeholder="https://..."
              />
            </Field>
            <button type="submit" className="button primary auth-submit-button" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>
        )}

        <div className="auth-divider">
          <span>Google sign-in</span>
        </div>

        <div className="auth-oauth-panel">
          <Field label="Sign in with Google as">
            <select value={oauthRole} onChange={(event) => setOauthRole(event.target.value)}>
              <option value="PATIENT">Patient</option>
              <option value="PROVIDER">Provider</option>
            </select>
          </Field>
          <button type="button" className="button ghost oauth-button" onClick={handleGoogleLogin}>
            <span className="google-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path
                  fill="#4285F4"
                  d="M21.64 12.2c0-.68-.06-1.33-.17-1.95H12v3.69h5.41a4.63 4.63 0 0 1-2 3.04v2.52h3.24c1.9-1.75 2.99-4.34 2.99-7.3Z"
                />
                <path
                  fill="#34A853"
                  d="M12 22c2.7 0 4.96-.9 6.61-2.45l-3.24-2.52c-.9.6-2.05.96-3.37.96-2.59 0-4.79-1.75-5.57-4.1H3.08v2.6A9.99 9.99 0 0 0 12 22Z"
                />
                <path
                  fill="#FBBC05"
                  d="M6.43 13.89A5.98 5.98 0 0 1 6.12 12c0-.66.11-1.3.31-1.89V7.51H3.08A9.99 9.99 0 0 0 2 12c0 1.61.39 3.13 1.08 4.49l3.35-2.6Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 6.01c1.47 0 2.8.51 3.84 1.52l2.88-2.88C16.95 3 14.69 2 12 2A9.99 9.99 0 0 0 3.08 7.51l3.35 2.6c.78-2.35 2.98-4.1 5.57-4.1Z"
                />
              </svg>
            </span>
            <span>Continue with Google</span>
          </button>
          <p className="field-hint">This choice is used when a Google account is signing in for the first time.</p>
        </div>
      </section>
    </div>
  );
}

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [form, setForm] = useState({
    newPassword: "",
    confirmPassword: ""
  });

  async function handleResetPassword(event) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!token) {
      setError("Reset token is missing from this link.");
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError("Confirm password must match the new password.");
      return;
    }

    setLoading(true);

    try {
      const response = await apiRequest("/api/v1/auth/reset-password", {
        method: "POST",
        body: {
          token,
          newPassword: form.newPassword
        }
      });
      setSuccessMessage(response.message || "Password reset successfully. You can log in now.");
      setForm({
        newPassword: "",
        confirmPassword: ""
      });
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="section-card auth-card auth-console-card auth-reset-page">
      <div className="auth-card-header">
        <div>
          <span className="eyebrow auth-console-eyebrow">Password Reset</span>
          <h2>Choose a new MediBook password</h2>
        </div>
        <p>Use the secure link from your email to set a new password for your account.</p>
      </div>

      {!token ? <div className="state-box state-error">Reset token is missing from this link.</div> : null}
      {error ? <div className="state-box state-error">{error}</div> : null}
      {successMessage ? <div className="state-box state-success">{successMessage}</div> : null}

      <form className="form-grid auth-form-grid" onSubmit={handleResetPassword}>
        <Field label="New password" hint="Minimum 8 characters.">
          <input
            value={form.newPassword}
            onChange={(event) => setForm((current) => ({ ...current, newPassword: event.target.value }))}
            type="password"
            placeholder="Create a strong password"
            required
            minLength={8}
          />
        </Field>
        <Field label="Confirm password">
          <input
            value={form.confirmPassword}
            onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))}
            type="password"
            placeholder="Re-enter your new password"
            required
            minLength={8}
          />
        </Field>
        <div className="auth-secondary-actions">
          <button type="submit" className="button primary auth-submit-button" disabled={loading || !token}>
            {loading ? "Resetting..." : "Reset password"}
          </button>
          <Link className="button ghost" to="/auth">
            Back to login
          </Link>
        </div>
      </form>
    </section>
  );
}

function OAuthRedirectPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) {
      return undefined;
    }

    hasStartedRef.current = true;
    let cancelled = false;

    async function completeOAuthRedirect() {
      const accessToken = searchParams.get("accessToken");
      const refreshToken = searchParams.get("refreshToken");
      const oauthError = searchParams.get("error");

      if (oauthError) {
        setError(oauthError);
        return;
      }

      if (!accessToken || !refreshToken) {
        setError("Google sign-in did not return a complete session.");
        return;
      }

      try {
        await auth.completeOAuthLogin({ accessToken, refreshToken });

        if (!cancelled) {
          navigate(consumePostOAuthRedirect(), { replace: true });
        }
      } catch (redirectError) {
        if (!cancelled) {
          setError(getErrorMessage(redirectError));
        }
      }
    }

    completeOAuthRedirect();

    return () => {
      cancelled = true;
    };
  }, [auth, navigate, searchParams]);

  return (
    <section className="section-card oauth-redirect-card">
      <h3>Finishing Google sign-in</h3>
      {error ? (
        <div className="state-box state-error">{error}</div>
      ) : (
        <div className="state-box">We are validating your Google session and loading your account.</div>
      )}
      <Link className="button ghost" to="/auth">
        Back to login
      </Link>
    </section>
  );
}

function HomePage() {
  const [filters, setFilters] = useState({
    search: "",
    specialization: "",
    location: "",
    available: true
  });
  const deferredSearch = useDeferredValue(filters.search);

  const providers = useApiResource(
    [],
    [deferredSearch, filters.specialization, filters.location, filters.available],
    () =>
      apiRequest(
        `/api/v1/providers${buildQuery({
          search: deferredSearch || undefined,
          specialization: filters.specialization || undefined,
          location: filters.location || undefined,
          available: filters.available ? true : undefined,
          verified: true
        })}`
      )
  );

  return (
    <div className="page-stack">
      <section className="hero-panel hero-large">
        <div className="hero-copy">
          <span className="eyebrow">Online Appointment Booking System</span>
          <h1>Browse providers, check live slots, and move from discovery to booking fast.</h1>
          <p className="hero-support-copy">
            MediBook keeps search, scheduling, online payments, and post-visit follow-up in a cleaner
            patient-first flow.
          </p>
        </div>
        <div className="hero-metrics">
          <StatCard label="Search experience" value="Guest-ready" tone="warning" />
          <StatCard label="Payments" value="Razorpay-enabled" tone="success" />
          <StatCard label="Workspaces" value="Patient, Provider, Admin" tone="success" />
        </div>
      </section>

      <SectionCard title="Find a Provider" subtitle="Search by name, clinic, specialization, or location.">
        <div className="form-grid search-grid">
          <Field label="Search">
            <input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Doctor name, clinic, keyword"
            />
          </Field>
          <Field label="Specialization">
            <input
              value={filters.specialization}
              onChange={(event) =>
                setFilters((current) => ({ ...current, specialization: event.target.value }))
              }
              placeholder="Cardiology, ENT, Dental..."
            />
          </Field>
          <Field label="Location">
            <input
              value={filters.location}
              onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}
              placeholder="City or clinic address"
            />
          </Field>
          <Field label="Availability">
            <select
              value={String(filters.available)}
              onChange={(event) =>
                setFilters((current) => ({ ...current, available: event.target.value === "true" }))
              }
            >
              <option value="true">Available now</option>
              <option value="false">Any availability</option>
            </select>
          </Field>
        </div>

        <DataState
          loading={providers.loading}
          error={providers.error}
          data={providers.data}
          emptyMessage="No providers match those filters."
        >
          <div className="card-grid">
            {providers.data.map((provider) => (
              <article key={provider.providerId} className="info-card provider-card">
                <div className="provider-head">
                  <div className="avatar-shell">
                    {provider.profilePicUrl ? (
                      <img src={provider.profilePicUrl} alt={provider.fullName} className="avatar-image" />
                    ) : (
                      <span>{provider.fullName?.charAt(0) || "P"}</span>
                    )}
                  </div>
                  <div>
                    <h3>{provider.fullName}</h3>
                    <p>{provider.specialization}</p>
                  </div>
                </div>
                <div className="meta-row">
                  <span className={classNames("pill", `pill-${statusTone(provider.available ? "ACTIVE" : "INACTIVE")}`)}>
                    {provider.available ? "Available" : "Busy"}
                  </span>
                  <span className={classNames("pill", `pill-${statusTone(provider.verified ? "VERIFIED" : "PENDING")}`)}>
                    {provider.verified ? "Verified" : "Pending"}
                  </span>
                </div>
                <p className="muted">{provider.clinicName || "Clinic info unavailable"}</p>
                <p>{provider.clinicAddress || "Address unavailable"}</p>
                <div className="meta-row">
                  <span>{provider.experienceYears || 0}+ years</span>
                  <span>
                    {provider.avgRating ? `${provider.avgRating} rating` : "No rating"} {provider.reviewCount || 0} reviews
                  </span>
                </div>
                <Link className="button primary" to={`/providers/${provider.providerId}`}>
                  View Profile & Slots
                </Link>
              </article>
            ))}
          </div>
        </DataState>
      </SectionCard>
    </div>
  );
}

function ProviderDetailPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { providerId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(defaultDate());
  const [bookingForm, setBookingForm] = useState({
    slotId: "",
    serviceType: "General Consultation",
    modeOfConsultation: "IN_PERSON",
    notes: "",
    payNow: true,
    amount: "500",
    paymentMode: "CARD",
    paymentNotes: ""
  });
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const provider = useApiResource(null, [providerId], () => apiRequest(`/api/v1/providers/${providerId}`));
  const reviews = useApiResource([], [providerId], () => apiRequest(`/api/v1/reviews/providers/${providerId}`));
  const slots = useApiResource(
    [],
    [providerId, selectedDate, reloadKey],
    () => apiRequest(`/api/v1/schedules/providers/${providerId}/slots${buildQuery({ date: selectedDate })}`)
  );
  const providerInfo = provider.data ?? {};

  useEffect(() => {
    const firstOpenSlot = slots.data.find((slot) => !slot.booked && !slot.blocked);
    if (firstOpenSlot) {
      setBookingForm((current) => ({
        ...current,
        slotId: current.slotId && slots.data.some((slot) => slot.slotId === current.slotId) ? current.slotId : firstOpenSlot.slotId
      }));
    }
  }, [slots.data]);

  async function handleBooking(event) {
    event.preventDefault();
    setSubmitting(true);
    setActionError("");
    setActionSuccess("");

    try {
      if (!auth.user) {
        navigate("/auth", {
          state: { from: `/providers/${providerId}${searchParams.toString() ? `?${searchParams}` : ""}` }
        });
        return;
      }

      if (auth.user.role !== "PATIENT") {
        throw new Error("Only patient accounts can book or reschedule appointments from this page.");
      }

      const rescheduleId = searchParams.get("reschedule");

      if (rescheduleId) {
        await apiRequest(`/api/v1/appointments/${rescheduleId}/reschedule`, {
          method: "PUT",
          body: {
            slotId: bookingForm.slotId
          }
        });
        setSearchParams({});
        setActionSuccess("Appointment rescheduled successfully.");
      } else {
        const appointment = await apiRequest("/api/v1/appointments", {
          method: "POST",
          body: {
            providerId,
            slotId: bookingForm.slotId,
            serviceType: bookingForm.serviceType,
            modeOfConsultation: bookingForm.modeOfConsultation,
            notes: bookingForm.notes || null
          }
        });

        if (bookingForm.payNow) {
          await startPatientCheckoutPayment({
            appointmentId: appointment.appointmentId,
            amount: bookingForm.amount,
            mode: bookingForm.paymentMode,
            notes: bookingForm.paymentNotes,
            authUser: auth.user
          });
          setActionSuccess(
            isOnlinePaymentMode(bookingForm.paymentMode)
              ? "Appointment booked and payment completed successfully."
              : "Appointment booked successfully. Cash collection stays pending until the clinic receives it."
          );
        } else {
          setActionSuccess("Appointment booked successfully.");
        }
      }

      setReloadKey((value) => value + 1);
    } catch (submitError) {
      setActionError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <SectionCard title="Provider Profile" subtitle="Detailed provider information with real-time slot visibility.">
        <DataState
          loading={provider.loading}
          error={provider.error}
          data={provider.data}
          emptyMessage="Provider not found."
        >
          <div className="detail-grid">
            <div className="info-card highlight-card">
              <div className="provider-head">
                <div className="avatar-shell large">
                  {providerInfo.profilePicUrl ? (
                    <img src={providerInfo.profilePicUrl} alt={providerInfo.fullName} className="avatar-image" />
                  ) : (
                    <span>{providerInfo.fullName?.charAt(0) || "P"}</span>
                  )}
                </div>
                <div>
                  <h2>{providerInfo.fullName || "Provider"}</h2>
                  <p>{providerInfo.specialization || "Specialization unavailable"}</p>
                  <div className="meta-row">
                    <span className={classNames("pill", `pill-${statusTone(providerInfo.verified ? "VERIFIED" : "PENDING")}`)}>
                      {providerInfo.verified ? "Verified Provider" : "Pending Verification"}
                    </span>
                    <span className={classNames("pill", `pill-${statusTone(providerInfo.available ? "ACTIVE" : "INACTIVE")}`)}>
                      {providerInfo.available ? "Accepting appointments" : "Currently unavailable"}
                    </span>
                  </div>
                </div>
              </div>
              <p>{providerInfo.bio || "Bio not added yet."}</p>
              <div className="key-grid">
                <div>
                  <span className="muted">Qualification</span>
                  <strong>{providerInfo.qualification || "Not shared"}</strong>
                </div>
                <div>
                  <span className="muted">Experience</span>
                  <strong>{providerInfo.experienceYears || 0}+ years</strong>
                </div>
                <div>
                  <span className="muted">Clinic</span>
                  <strong>{providerInfo.clinicName || "Not shared"}</strong>
                </div>
                <div>
                  <span className="muted">Address</span>
                  <strong>{providerInfo.clinicAddress || "Not shared"}</strong>
                </div>
                <div>
                  <span className="muted">Rating</span>
                  <strong>
                    {providerInfo.avgRating ? `${providerInfo.avgRating} / 5` : "No ratings"} ({providerInfo.reviewCount || 0} reviews)
                  </strong>
                </div>
                <div>
                  <span className="muted">Contact</span>
                  <strong>{providerInfo.phone || providerInfo.email || "Unavailable"}</strong>
                </div>
              </div>
            </div>

            <div className="info-card">
              <div className="section-head compact">
                <div>
                  <h3>{searchParams.get("reschedule") ? "Reschedule Appointment" : "Book Appointment"}</h3>
                  <p>Select a date, choose a live slot, and confirm.</p>
                </div>
              </div>

              <Field label="Choose date">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </Field>

              <DataState
                loading={slots.loading}
                error={slots.error}
                data={slots.data}
                emptyMessage="No slots published for that date."
              >
                <div className="slot-grid">
                  {slots.data.map((slot) => {
                    const disabled = slot.booked || slot.blocked;
                    return (
                      <label
                        key={slot.slotId}
                        className={classNames(
                          "slot-card",
                          bookingForm.slotId === slot.slotId && "slot-selected",
                          disabled && "slot-disabled"
                        )}
                      >
                        <input
                          type="radio"
                          name="slot"
                          value={slot.slotId}
                          checked={bookingForm.slotId === slot.slotId}
                          onChange={(event) =>
                            setBookingForm((current) => ({ ...current, slotId: event.target.value }))
                          }
                          disabled={disabled}
                        />
                        <strong>
                          {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                        </strong>
                        <span>{slot.durationMinutes} mins</span>
                        <small>
                          {slot.blocked
                            ? slot.blockedReason || "Blocked"
                            : slot.booked
                              ? "Already booked"
                              : "Available"}
                        </small>
                      </label>
                    );
                  })}
                </div>
              </DataState>

              <form className="form-grid" onSubmit={handleBooking}>
                <Field label="Service type">
                  <input
                    value={bookingForm.serviceType}
                    onChange={(event) =>
                      setBookingForm((current) => ({ ...current, serviceType: event.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Consultation mode">
                  <select
                    value={bookingForm.modeOfConsultation}
                    onChange={(event) =>
                      setBookingForm((current) => ({ ...current, modeOfConsultation: event.target.value }))
                    }
                  >
                    {CONSULTATION_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {formatEnum(mode)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Notes">
                  <textarea
                    value={bookingForm.notes}
                    onChange={(event) => setBookingForm((current) => ({ ...current, notes: event.target.value }))}
                    rows={3}
                    placeholder="Symptoms or special requests"
                  />
                </Field>
                {!searchParams.get("reschedule") ? (
                  <>
                    <Field label="Payment timing">
                      <select
                        value={String(bookingForm.payNow)}
                        onChange={(event) =>
                          setBookingForm((current) => ({ ...current, payNow: event.target.value === "true" }))
                        }
                      >
                        <option value="true">Pay now</option>
                        <option value="false">Pay later / at clinic</option>
                      </select>
                    </Field>
                    {bookingForm.payNow ? (
                      <>
                        <Field label="Amount">
                          <input
                            type="number"
                            min="1"
                            step="0.01"
                            value={bookingForm.amount}
                            onChange={(event) =>
                              setBookingForm((current) => ({ ...current, amount: event.target.value }))
                            }
                            required
                          />
                        </Field>
                        <Field label="Payment mode">
                          <select
                            value={bookingForm.paymentMode}
                            onChange={(event) =>
                              setBookingForm((current) => ({ ...current, paymentMode: event.target.value }))
                            }
                          >
                            {ONLINE_PAYMENT_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {formatEnum(mode)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Payment notes">
                          <input
                            value={bookingForm.paymentNotes}
                            onChange={(event) =>
                              setBookingForm((current) => ({ ...current, paymentNotes: event.target.value }))
                            }
                            placeholder="Optional note"
                          />
                        </Field>
                      </>
                    ) : null}
                  </>
                ) : null}

                {actionError ? <div className="state-box state-error">{actionError}</div> : null}
                {actionSuccess ? <div className="state-box state-success">{actionSuccess}</div> : null}

                <button type="submit" className="button primary" disabled={submitting || !bookingForm.slotId}>
                  {submitting
                    ? "Submitting..."
                    : searchParams.get("reschedule")
                      ? "Confirm Reschedule"
                      : "Book Appointment"}
                </button>
              </form>
            </div>
          </div>
        </DataState>
      </SectionCard>

      <SectionCard title="Patient Reviews" subtitle="What recent patients are saying about this provider.">
        <DataState
          loading={reviews.loading}
          error={reviews.error}
          data={reviews.data}
          emptyMessage="No reviews yet."
        >
          <div className="stack-list">
            {reviews.data.map((review) => (
              <article key={review.reviewId} className="info-card">
                <div className="meta-row">
                  <span className="pill pill-warning">{review.rating} / 5</span>
                  <span className="muted">{formatInstant(review.reviewDate)}</span>
                </div>
                <p>{review.comment || "No written comment."}</p>
                <div className="meta-row">
                  <span>{review.anonymous ? "Anonymous patient" : "Verified patient"}</span>
                  {review.flagged ? <span className="pill pill-danger">Flagged</span> : null}
                </div>
              </article>
            ))}
          </div>
        </DataState>
      </SectionCard>
    </div>
  );
}

function DashboardPage() {
  const auth = useAuth();

  if (!auth.user) {
    return null;
  }

  return (
    <div className="page-stack">
      <section className="hero-panel dashboard-hero">
        <span className="eyebrow">{formatEnum(auth.user.role)} Workspace</span>
        <h1>{auth.user.fullName}</h1>
        <p>
          Manage the flows tied to your role while staying connected to the same backend services and
          business rules.
        </p>
        <div className="row-actions">
          <Link to="/profile" className="button primary">
            View Profile
          </Link>
        </div>
      </section>

      {auth.user.role === "PATIENT" ? <PatientDashboard /> : null}
      {auth.user.role === "PROVIDER" ? <ProviderDashboard /> : null}
      {auth.user.role === "ADMIN" ? <AdminDashboard /> : null}
    </div>
  );
}

function ProfilePage() {
  const auth = useAuth();

  if (!auth.user) {
    return null;
  }

  return (
    <div className="page-stack">
      <section className="hero-panel dashboard-hero">
        <span className="eyebrow">Account Profile</span>
        <h1>{auth.user.fullName}</h1>
        <p>Review your account details, update contact info, and manage password or account access here.</p>
        <div className="row-actions">
          <Link to="/dashboard" className="button ghost">
            Back to Dashboard
          </Link>
        </div>
      </section>

      <AccountPanel />
    </div>
  );
}

function AccountPanel() {
  const auth = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    phone: "",
    profilePicUrl: ""
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: ""
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const profile = useApiResource(null, [refreshKey], () => apiRequest("/api/v1/auth/profile"));
  const profileInfo = profile.data ?? auth.user ?? {};
  const isLocalAccount = (profileInfo.authProvider || "").toUpperCase() === "LOCAL";

  useEffect(() => {
    if (profile.data || auth.user) {
      const source = profile.data ?? auth.user;
      setProfileForm({
        fullName: source?.fullName || "",
        phone: source?.phone || "",
        profilePicUrl: source?.profilePicUrl || ""
      });
    }
  }, [profile.data, auth.user]);

  async function handleProfileSave(event) {
    event.preventDefault();
    setSavingProfile(true);
    setError("");

    try {
      const updated = await apiRequest("/api/v1/auth/profile", {
        method: "PUT",
        body: profileForm
      });
      auth.mergeUser(updated);
      setRefreshKey((value) => value + 1);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    setSavingPassword(true);
    setError("");
    setPasswordMessage("");

    try {
      const response = await apiRequest("/api/v1/auth/password", {
        method: "PUT",
        body: passwordForm
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: ""
      });
      await auth.logout(response.message || "Password changed successfully. Please sign in again.");
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleDeactivate() {
    const confirmed = window.confirm("Deactivate this account? You will be logged out immediately.");
    if (!confirmed) {
      return;
    }

    const passwordConfirmation = isLocalAccount
      ? window.prompt("Enter your current password to confirm account deactivation.") || ""
      : null;

    if (isLocalAccount && !passwordConfirmation) {
      setError("Password confirmation is required to deactivate this account.");
      return;
    }

    try {
      await apiRequest("/api/v1/auth/deactivate", {
        method: "PUT",
        body: {
          passwordConfirmation
        }
      });
      await auth.logout();
    } catch (deactivateError) {
      setError(getErrorMessage(deactivateError));
    }
  }

  return (
    <SectionCard
      title="Account Settings"
      subtitle="Keep profile, password, and account state up to date without taking over the dashboard."
      className="account-panel-shell"
      headingClassName="compact"
    >
      <DataState
        loading={profile.loading}
        error={profile.error}
        data={profileInfo}
        emptyMessage="Profile could not be loaded."
      >
        <div className="account-layout">
          <div className="info-card account-summary-card">
            <div className="provider-head">
              <div className="avatar-shell">
                {profileInfo.profilePicUrl ? (
                  <img src={profileInfo.profilePicUrl} alt={profileInfo.fullName} className="avatar-image" />
                ) : (
                  <span>{profileInfo.fullName?.charAt(0) || "U"}</span>
                )}
              </div>
              <div>
                <h3>{profileInfo.fullName || "User"}</h3>
                <p>{profileInfo.email || "Email unavailable"}</p>
                <div className="meta-row">
                  <span className="pill pill-neutral">{formatEnum(profileInfo.role)}</span>
                  <span className={classNames("pill", `pill-${statusTone(profileInfo.active ? "ACTIVE" : "INACTIVE")}`)}>
                    {profileInfo.active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            </div>
            <div className="key-grid">
              <div>
                <span className="muted">Phone</span>
                <strong>{profileInfo.phone || "Not updated"}</strong>
              </div>
              <div>
                <span className="muted">Auth Provider</span>
                <strong>{formatEnum(profileInfo.authProvider)}</strong>
              </div>
              <div>
                <span className="muted">Created</span>
                <strong>{formatInstant(profileInfo.createdAt)}</strong>
              </div>
            </div>

            <form className="account-summary-editor" onSubmit={handleProfileSave}>
              <div className="account-summary-divider" />
              <h3>Edit profile</h3>
              <div className="account-form-grid">
                <Field label="Full name">
                  <input
                    value={profileForm.fullName}
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, fullName: event.target.value }))
                    }
                  />
                </Field>
                <Field label="Phone">
                  <input
                    value={profileForm.phone}
                    onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))}
                  />
                </Field>
                <Field label="Profile picture URL" hint="Paste an image URL if you want a profile photo.">
                  <input
                    value={profileForm.profilePicUrl}
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, profilePicUrl: event.target.value }))
                    }
                  />
                </Field>
              </div>
              <div className="account-actions">
                <button type="submit" className="button primary" disabled={savingProfile}>
                  {savingProfile ? "Saving..." : "Save profile"}
                </button>
              </div>
            </form>

            <div className="account-summary-divider" />
            <div className="account-summary-editor">
              <h3>Change password</h3>
              {isLocalAccount ? (
                <form onSubmit={handlePasswordChange}>
                  <div className="account-form-grid">
                    <Field label="Current password">
                      <input
                        type="password"
                        value={passwordForm.currentPassword}
                        onChange={(event) =>
                          setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="New password">
                      <input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(event) =>
                          setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  {passwordMessage ? <div className="state-box state-success">{passwordMessage}</div> : null}
                  <div className="account-actions">
                    <button type="submit" className="button primary" disabled={savingPassword}>
                      {savingPassword ? "Updating..." : "Update password"}
                    </button>
                  </div>
                  <div className="account-danger-zone">
                    <div className="account-danger-copy">
                      <h4>Deactivate account</h4>
                      <p>
                        This will disable your account and revoke access until an administrator restores it.
                      </p>
                    </div>
                    <button type="button" className="button ghost danger" onClick={handleDeactivate}>
                      Deactivate account
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="muted">
                    Password changes are managed by {formatEnum(profileInfo.authProvider)} for this account.
                  </p>
                  <div className="account-danger-zone">
                    <div className="account-danger-copy">
                      <h4>Deactivate account</h4>
                      <p>
                        If you no longer want to use this account, you can disable it here.
                      </p>
                    </div>
                    <button type="button" className="button ghost danger" onClick={handleDeactivate}>
                      Deactivate account
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {error ? <div className="state-box state-error">{error}</div> : null}
      </DataState>
    </SectionCard>
  );
}

function PatientDashboard() {
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState("appointments");
  const [refreshKey, setRefreshKey] = useState(0);
  const [cancelReasons, setCancelReasons] = useState({});
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [reviewForm, setReviewForm] = useState({
    appointmentId: "",
    rating: 5,
    comment: "",
    anonymous: false
  });
  const [editingReviewId, setEditingReviewId] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [sectionError, setSectionError] = useState("");

  const upcomingAppointments = useApiResource([], [refreshKey], () => apiRequest("/api/v1/appointments/me/upcoming"));
  const appointments = useApiResource([], [refreshKey], () => apiRequest("/api/v1/appointments/me"));
  const payments = useApiResource([], [refreshKey], () => apiRequest("/api/v1/payments/me"));
  const records = useApiResource([], [refreshKey], () => apiRequest("/api/v1/records/me"));
  const reviews = useApiResource([], [refreshKey], () => apiRequest("/api/v1/reviews/me"));
  const notifications = useApiResource([], [refreshKey], () => apiRequest("/api/v1/notifications/me"));

  async function refreshAll() {
    setRefreshKey((value) => value + 1);
  }

  async function cancelAppointment(appointmentId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/appointments/${appointmentId}/cancel`, {
        method: "PUT",
        body: {
          reason: cancelReasons[appointmentId] || null
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function processPayment(appointmentId) {
    try {
      setSectionError("");
      const draft = paymentDrafts[appointmentId] || {};
      await startPatientCheckoutPayment({
        appointmentId,
        amount: draft.amount,
        mode: draft.mode || "CARD",
        notes: draft.notes,
        authUser: auth.user
      });
      setPaymentDrafts((current) => ({
        ...current,
        [appointmentId]: {
          amount: "",
          mode: "CARD",
          notes: ""
        }
      }));
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function submitReview(event) {
    event.preventDefault();
    setReviewError("");

    try {
      if (editingReviewId) {
        await apiRequest(`/api/v1/reviews/${editingReviewId}`, {
          method: "PUT",
          body: {
            rating: Number(reviewForm.rating),
            comment: reviewForm.comment,
            anonymous: reviewForm.anonymous
          }
        });
      } else {
        await apiRequest("/api/v1/reviews", {
          method: "POST",
          body: {
            appointmentId: reviewForm.appointmentId,
            rating: Number(reviewForm.rating),
            comment: reviewForm.comment,
            anonymous: reviewForm.anonymous
          }
        });
      }

      setReviewForm({
        appointmentId: "",
        rating: 5,
        comment: "",
        anonymous: false
      });
      setEditingReviewId("");
      refreshAll();
    } catch (error) {
      setReviewError(getErrorMessage(error));
    }
  }

  async function deleteReview(reviewId) {
    try {
      await apiRequest(`/api/v1/reviews/${reviewId}`, {
        method: "DELETE"
      });
      refreshAll();
    } catch (error) {
      setReviewError(getErrorMessage(error));
    }
  }

  async function loadInvoice(paymentId) {
    try {
      setSectionError("");
      const result = await apiRequest(`/api/v1/payments/${paymentId}/invoice`);
      setInvoice(result);
      setActiveTab("payments");
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function markNotificationRead(notificationId) {
    await apiRequest(`/api/v1/notifications/${notificationId}/read`, {
      method: "PUT"
    });
    refreshAll();
  }

  async function deleteNotification(notificationId) {
    await apiRequest(`/api/v1/notifications/${notificationId}`, {
      method: "DELETE"
    });
    refreshAll();
  }

  async function markAllNotificationsRead() {
    await apiRequest("/api/v1/notifications/me/read-all", {
      method: "PUT"
    });
    refreshAll();
  }

  const appointmentStatusById = new Map(
    appointments.data.map((appointment) => [appointment.appointmentId, appointment.status])
  );

  function canOpenInvoice(payment) {
    const appointmentStatus = appointmentStatusById.get(payment.appointmentId);
    const hasCompletedPayment = payment.status === "PAID" || payment.status === "REFUNDED";
    return hasCompletedPayment && appointmentStatus === "COMPLETED";
  }

  const tabs = [
    { key: "appointments", label: "Appointments" },
    { key: "payments", label: "Payments" },
    { key: "records", label: "Records" },
    { key: "reviews", label: "Reviews" },
    { key: "notifications", label: "Notifications" }
  ];

  return (
    <SectionCard title="Patient Dashboard" subtitle="Book, pay, review, and track your care journey.">
      <div className="metrics-grid">
        <StatCard label="Upcoming appointments" value={upcomingAppointments.data.length} tone="warning" />
        <StatCard label="Payments logged" value={payments.data.length} tone="success" />
        <StatCard label="Records available" value={records.data.length} tone="neutral" />
        <StatCard label="Unread notifications" value={notifications.data.filter((item) => !item.read).length} tone="danger" />
      </div>
      {sectionError ? <div className="state-box state-error">{sectionError}</div> : null}
      <Tabs items={tabs} activeKey={activeTab} onChange={setActiveTab} />

      {activeTab === "appointments" ? (
        <div className="stack-list">
          <SectionCard title="Upcoming Appointments" subtitle="Manage your scheduled visits.">
            <DataState
              loading={upcomingAppointments.loading}
              error={upcomingAppointments.error}
              data={upcomingAppointments.data}
              emptyMessage="No upcoming appointments."
            >
              <div className="stack-list">
                {upcomingAppointments.data.map((appointment) => (
                  <article key={appointment.appointmentId} className="info-card">
                    <div className="meta-row">
                      <span className={classNames("pill", `pill-${statusTone(appointment.status)}`)}>
                        {formatEnum(appointment.status)}
                      </span>
                      <span className="muted">
                        {formatDate(appointment.appointmentDate)} â€¢ {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
                      </span>
                    </div>
                    <h3>{appointment.serviceType}</h3>
                    <p>
                      Consultation mode: {formatEnum(appointment.modeOfConsultation)}
                    </p>
                    {appointment.notes ? <p className="muted">Notes: {appointment.notes}</p> : null}
                    <div className="row-actions">
                      {appointment.status === "SCHEDULED" ? (
                        <>
                          <Link className="button ghost" to={`/providers/${appointment.providerId}?reschedule=${appointment.appointmentId}`}>
                            Reschedule
                          </Link>
                          <details className="details-card">
                            <summary>Cancel</summary>
                            <Field label="Cancellation reason">
                              <input
                                value={cancelReasons[appointment.appointmentId] || ""}
                                onChange={(event) =>
                                  setCancelReasons((current) => ({
                                    ...current,
                                    [appointment.appointmentId]: event.target.value
                                  }))
                                }
                                placeholder="Optional reason"
                              />
                            </Field>
                            <button
                              type="button"
                              className="button ghost danger"
                              onClick={() => cancelAppointment(appointment.appointmentId)}
                            >
                              Confirm cancel
                            </button>
                          </details>
                        </>
                      ) : null}
                      <details className="details-card">
                        <summary>Pay now</summary>
                        <div className="form-grid">
                          <Field label="Amount">
                            <input
                              type="number"
                              min="1"
                              step="0.01"
                              value={paymentDrafts[appointment.appointmentId]?.amount || ""}
                              onChange={(event) =>
                                setPaymentDrafts((current) => ({
                                  ...current,
                                  [appointment.appointmentId]: {
                                    ...current[appointment.appointmentId],
                                    amount: event.target.value
                                  }
                                }))
                              }
                            />
                          </Field>
                          <Field label="Mode">
                            <select
                              value={paymentDrafts[appointment.appointmentId]?.mode || "CARD"}
                              onChange={(event) =>
                                setPaymentDrafts((current) => ({
                                  ...current,
                                  [appointment.appointmentId]: {
                                    ...current[appointment.appointmentId],
                                    mode: event.target.value
                                  }
                                }))
                              }
                            >
                              {ONLINE_PAYMENT_MODES.map((mode) => (
                                <option key={mode} value={mode}>
                                  {formatEnum(mode)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Notes">
                            <input
                              value={paymentDrafts[appointment.appointmentId]?.notes || ""}
                              onChange={(event) =>
                                setPaymentDrafts((current) => ({
                                  ...current,
                                  [appointment.appointmentId]: {
                                    ...current[appointment.appointmentId],
                                    notes: event.target.value
                                  }
                                }))
                              }
                            />
                          </Field>
                        </div>
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => processPayment(appointment.appointmentId)}
                        >
                          Pay with Razorpay
                        </button>
                      </details>
                      {appointment.status === "COMPLETED" ? (
                        <button
                          type="button"
                          className="button ghost"
                          onClick={() => {
                            setReviewForm((current) => ({ ...current, appointmentId: appointment.appointmentId }));
                            setEditingReviewId("");
                            setActiveTab("reviews");
                          }}
                        >
                          Write review
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>

          <SectionCard title="Full Appointment History" subtitle="See all appointment states in one place.">
            <DataState
              loading={appointments.loading}
              error={appointments.error}
              data={appointments.data}
              emptyMessage="No appointment history yet."
            >
              <div className="stack-list">
                {appointments.data.map((appointment) => (
                  <article key={appointment.appointmentId} className="info-card">
                    <div className="meta-row">
                      <span className={classNames("pill", `pill-${statusTone(appointment.status)}`)}>
                        {formatEnum(appointment.status)}
                      </span>
                      <span>{formatDate(appointment.appointmentDate)}</span>
                    </div>
                    <h3>{appointment.serviceType}</h3>
                    <p>
                      {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
                    </p>
                    {appointment.cancellationReason ? (
                      <p className="muted">Cancellation reason: {appointment.cancellationReason}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "payments" ? (
        <div className="stack-list">
          {invoice ? (
            <SectionCard title="Latest Invoice" subtitle="Most recently opened invoice data.">
              <div className="key-grid">
                <div>
                  <span className="muted">Invoice number</span>
                  <strong>{invoice.invoiceNumber}</strong>
                </div>
                <div>
                  <span className="muted">Amount</span>
                  <strong>{formatCurrency(invoice.amount, invoice.currency || "INR")}</strong>
                </div>
                <div>
                  <span className="muted">Status</span>
                  <strong>{formatEnum(invoice.status)}</strong>
                </div>
                <div>
                  <span className="muted">Mode</span>
                  <strong>{formatEnum(invoice.mode)}</strong>
                </div>
                <div>
                  <span className="muted">Generated</span>
                  <strong>{formatInstant(invoice.generatedAt)}</strong>
                </div>
              </div>
            </SectionCard>
          ) : null}
          <SectionCard title="Payment History" subtitle="Track transactions, statuses, and invoice access.">
            <DataState
              loading={payments.loading}
              error={payments.error}
              data={payments.data}
              emptyMessage="No payments recorded yet."
            >
              <div className="stack-list">
                {payments.data.map((payment) => (
                  <article key={payment.paymentId} className="info-card">
                    <div className="meta-row">
                      <span className={classNames("pill", `pill-${statusTone(payment.status)}`)}>
                        {formatEnum(payment.status)}
                      </span>
                      <span className="muted">{formatInstant(payment.createdAt)}</span>
                    </div>
                    <h3>{formatCurrency(payment.amount, payment.currency || "INR")}</h3>
                    <p>{formatEnum(payment.mode)}</p>
                    {canOpenInvoice(payment) ? (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button ghost"
                          onClick={() => loadInvoice(payment.paymentId)}
                        >
                          Open invoice
                        </button>
                      </div>
                    ) : (
                      <p className="muted">Invoice becomes available after payment is completed and the appointment is marked completed.</p>
                    )}
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "records" ? (
        <SectionCard title="Medical Records" subtitle="Review diagnoses, prescriptions, notes, and follow-ups.">
          <DataState
            loading={records.loading}
            error={records.error}
            data={records.data}
            emptyMessage="No medical records are available yet."
          >
            <div className="stack-list">
              {records.data.map((record) => (
                <article key={record.recordId} className="info-card">
                  <div className="meta-row">
                    <span className="pill pill-neutral">Medical record</span>
                    <span className="muted">{formatInstant(record.createdAt)}</span>
                  </div>
                  <h3>{record.diagnosis}</h3>
                  <p>{record.prescription}</p>
                  {record.notes ? <p className="muted">{record.notes}</p> : null}
                  <div className="meta-row">
                    <span>Provider record</span>
                    <span>Follow-up: {record.followUpDate ? formatDate(record.followUpDate) : "Not set"}</span>
                  </div>
                  {record.attachmentUrl ? (
                    <a className="button ghost" href={record.attachmentUrl} target="_blank" rel="noreferrer">
                      Open attachment
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "reviews" ? (
        <div className="stack-list">
          <SectionCard title={editingReviewId ? "Edit Review" : "Create Review"} subtitle="Reviews are tied to completed appointments.">
            <form className="form-grid" onSubmit={submitReview}>
              <Field label="Appointment ID">
                <input
                  value={reviewForm.appointmentId}
                  onChange={(event) =>
                    setReviewForm((current) => ({ ...current, appointmentId: event.target.value }))
                  }
                  disabled={Boolean(editingReviewId)}
                  required
                />
              </Field>
              <p className="form-helper-text">
                Use the completed appointment ID here, not the slot ID shown in provider schedules.
              </p>
              <Field label="Rating">
                <select
                  value={String(reviewForm.rating)}
                  onChange={(event) =>
                    setReviewForm((current) => ({ ...current, rating: Number(event.target.value) }))
                  }
                >
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Comment">
                <textarea
                  rows={4}
                  value={reviewForm.comment}
                  onChange={(event) =>
                    setReviewForm((current) => ({ ...current, comment: event.target.value }))
                  }
                />
              </Field>
              <Field label="Anonymous">
                <select
                  value={String(reviewForm.anonymous)}
                  onChange={(event) =>
                    setReviewForm((current) => ({ ...current, anonymous: event.target.value === "true" }))
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </Field>
              {reviewError ? <div className="state-box state-error">{reviewError}</div> : null}
              <div className="row-actions">
                <button type="submit" className="button primary">
                  {editingReviewId ? "Update Review" : "Submit Review"}
                </button>
                {editingReviewId ? (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setEditingReviewId("");
                      setReviewForm({
                        appointmentId: "",
                        rating: 5,
                        comment: "",
                        anonymous: false
                      });
                    }}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          </SectionCard>

          <SectionCard title="My Reviews" subtitle="Edit or remove your submitted reviews.">
            <DataState
              loading={reviews.loading}
              error={reviews.error}
              data={reviews.data}
              emptyMessage="No reviews submitted yet."
            >
              <div className="stack-list">
                {reviews.data.map((review) => (
                  <article key={review.reviewId} className="info-card">
                    <div className="meta-row">
                      <span className="pill pill-warning">{review.rating} / 5</span>
                      <span className="muted">{formatInstant(review.reviewDate)}</span>
                    </div>
                    <h3>Appointment review</h3>
                    <p>{review.comment || "No written comment."}</p>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => {
                          setEditingReviewId(review.reviewId);
                          setReviewForm({
                            appointmentId: review.appointmentId,
                            rating: review.rating,
                            comment: review.comment || "",
                            anonymous: review.anonymous
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button ghost danger"
                        onClick={() => deleteReview(review.reviewId)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "notifications" ? (
        <NotificationFeed
          notifications={notifications.data}
          loading={notifications.loading}
          error={notifications.error}
          onRead={markNotificationRead}
          onDelete={deleteNotification}
          onReadAll={markAllNotificationsRead}
        />
      ) : null}
    </SectionCard>
  );
}

function ProviderDashboard() {
  const [activeTab, setActiveTab] = useState("profile");
  const [refreshKey, setRefreshKey] = useState(0);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [profileMissing, setProfileMissing] = useState(false);
  const [providerProfile, setProviderProfile] = useState(null);
  const [providerForm, setProviderForm] = useState({
    specialization: "",
    qualification: "",
    experienceYears: 0,
    bio: "",
    clinicName: "",
    clinicAddress: "",
    available: true
  });
  const [singleSlotForm, setSingleSlotForm] = useState({
    date: defaultDate(),
    startTime: "10:00",
    endTime: "10:30",
    durationMinutes: 30
  });
  const [recurringForm, setRecurringForm] = useState({
    startDate: defaultDate(),
    endDate: defaultDate(14),
    startTime: "10:00",
    endTime: "10:30",
    durationMinutes: 30,
    recurrenceType: "WEEKLY",
    daysOfWeek: ["MONDAY", "WEDNESDAY", "FRIDAY"],
    intervalDays: 2
  });
  const [recordForm, setRecordForm] = useState({
    appointmentId: "",
    diagnosis: "",
    prescription: "",
    notes: "",
    attachmentUrl: "",
    followUpDate: ""
  });
  const [editingRecordId, setEditingRecordId] = useState("");
  const [slotEdits, setSlotEdits] = useState({});
  const [blockReasons, setBlockReasons] = useState({});
  const [completeNotes, setCompleteNotes] = useState({});
  const [flagReasons, setFlagReasons] = useState({});
  const [sectionError, setSectionError] = useState("");
  const providerReady = !profileMissing && Boolean(providerProfile?.providerId);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setProfileLoading(true);
      setProfileError("");

      try {
        const profile = await apiRequest("/api/v1/providers/me");
        if (active) {
          setProviderProfile(profile);
          setProviderForm({
            specialization: profile.specialization || "",
            qualification: profile.qualification || "",
            experienceYears: profile.experienceYears || 0,
            bio: profile.bio || "",
            clinicName: profile.clinicName || "",
            clinicAddress: profile.clinicAddress || "",
            available: profile.available
          });
          setProfileMissing(false);
          setActiveTab((current) => (current === "profile" ? current : current));
        }
      } catch (error) {
        if (active) {
          if (error instanceof ApiError && error.status === 404) {
            setProviderProfile(null);
            setProfileMissing(true);
            setActiveTab("profile");
          } else {
            setProfileError(getErrorMessage(error));
          }
        }
      } finally {
        if (active) {
          setProfileLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const slots = useApiResource([], [refreshKey, providerReady], () =>
    providerReady
      ? apiRequest(`/api/v1/schedules/me/slots${buildQuery({ dateFrom: defaultDate(), dateTo: defaultDate(14) })}`)
      : []
  );
  const todayAppointments = useApiResource([], [refreshKey, providerReady], () =>
    providerReady ? apiRequest("/api/v1/appointments/provider/me/today") : []
  );
  const upcomingAppointments = useApiResource([], [refreshKey, providerReady], () =>
    providerReady ? apiRequest("/api/v1/appointments/provider/me/upcoming") : []
  );
  const records = useApiResource([], [refreshKey, providerReady], () =>
    providerReady ? apiRequest("/api/v1/records/providers/me") : []
  );
  const notifications = useApiResource([], [refreshKey], () => apiRequest("/api/v1/notifications/me"));
  const revenue = useApiResource(null, [refreshKey, providerReady], () =>
    providerReady ? apiRequest("/api/v1/payments/providers/me/revenue") : null
  );
  const reviews = useApiResource([], [refreshKey, providerProfile?.providerId], () =>
    providerProfile?.providerId ? apiRequest(`/api/v1/reviews/providers/${providerProfile.providerId}`) : []
  );

  useEffect(() => {
    if (profileMissing) {
      setSectionError("Complete your provider profile first. Availability, appointments, records, and revenue unlock after provider registration.");
      return;
    }

    setSectionError("");
  }, [profileMissing]);

  async function refreshAll() {
    setRefreshKey((value) => value + 1);
  }

  async function submitProviderProfile(event) {
    event.preventDefault();
      setSectionError("");

      try {
        if (profileMissing) {
          await apiRequest("/api/v1/providers/register", {
          method: "POST",
          body: providerForm
        });
      } else {
        await apiRequest("/api/v1/providers/me", {
          method: "PUT",
          body: {
            specialization: providerForm.specialization,
            qualification: providerForm.qualification,
            experienceYears: Number(providerForm.experienceYears),
            bio: providerForm.bio,
            clinicName: providerForm.clinicName,
            clinicAddress: providerForm.clinicAddress
          }
        });
      }

      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function syncAuthProfile() {
    try {
      setSectionError("");
      await apiRequest("/api/v1/providers/me/sync-auth-profile", {
        method: "POST"
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function toggleAvailability(value) {
    if (!providerProfile) {
      return;
    }

    try {
      setSectionError("");
      await apiRequest(`/api/v1/providers/${providerProfile.providerId}/availability`, {
        method: "PUT",
        body: {
          available: value
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function addSingleSlot(event) {
    event.preventDefault();
    try {
      setSectionError("");
      await apiRequest("/api/v1/schedules/slots", {
        method: "POST",
        body: {
          ...singleSlotForm,
          durationMinutes: Number(singleSlotForm.durationMinutes)
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function addRecurringSlots(event) {
    event.preventDefault();
    try {
      setSectionError("");
      await apiRequest("/api/v1/schedules/slots/recurring", {
        method: "POST",
        body: {
          ...recurringForm,
          durationMinutes: Number(recurringForm.durationMinutes),
          intervalDays: Number(recurringForm.intervalDays)
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function updateSlot(slotId) {
    const draft = slotEdits[slotId];
    if (!draft) {
      return;
    }

    try {
      setSectionError("");
      await apiRequest(`/api/v1/schedules/slots/${slotId}`, {
        method: "PUT",
        body: {
          ...draft,
          durationMinutes: Number(draft.durationMinutes)
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function blockSlot(slotId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/schedules/slots/${slotId}/block`, {
        method: "PUT",
        body: {
          reason: blockReasons[slotId] || null
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function unblockSlot(slotId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/schedules/slots/${slotId}/unblock`, {
        method: "PUT"
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function deleteSlot(slotId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/schedules/slots/${slotId}`, {
        method: "DELETE"
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function completeAppointment(appointmentId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/appointments/${appointmentId}/complete`, {
        method: "PUT",
        body: {
          notes: completeNotes[appointmentId] || null
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function submitRecord(event) {
    event.preventDefault();
    try {
      setSectionError("");

      if (editingRecordId) {
        await apiRequest(`/api/v1/records/${editingRecordId}`, {
          method: "PUT",
          body: {
            diagnosis: recordForm.diagnosis,
            prescription: recordForm.prescription,
            notes: recordForm.notes || null,
            followUpDate: recordForm.followUpDate || null
          }
        });

        if (recordForm.attachmentUrl) {
          await apiRequest(`/api/v1/records/${editingRecordId}/attachment`, {
            method: "PUT",
            body: {
              attachmentUrl: recordForm.attachmentUrl
            }
          });
        }
      } else {
        await apiRequest("/api/v1/records", {
          method: "POST",
          body: {
            appointmentId: recordForm.appointmentId,
            diagnosis: recordForm.diagnosis,
            prescription: recordForm.prescription,
            notes: recordForm.notes || null,
            attachmentUrl: recordForm.attachmentUrl || null,
            followUpDate: recordForm.followUpDate || null
          }
        });
      }

      setEditingRecordId("");
      setRecordForm({
        appointmentId: "",
        diagnosis: "",
        prescription: "",
        notes: "",
        attachmentUrl: "",
        followUpDate: ""
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function deleteRecord(recordId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/records/${recordId}`, {
        method: "DELETE"
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function flagReview(reviewId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/reviews/${reviewId}/flag`, {
        method: "PUT",
        body: {
          reason: flagReasons[reviewId]
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function markNotificationRead(notificationId) {
    await apiRequest(`/api/v1/notifications/${notificationId}/read`, {
      method: "PUT"
    });
    refreshAll();
  }

  async function deleteNotification(notificationId) {
    await apiRequest(`/api/v1/notifications/${notificationId}`, {
      method: "DELETE"
    });
    refreshAll();
  }

  async function markAllNotificationsRead() {
    await apiRequest("/api/v1/notifications/me/read-all", {
      method: "PUT"
    });
    refreshAll();
  }

  return (
    <SectionCard title="Provider Dashboard" subtitle="Control your profile, schedule, queue, records, and earnings.">
      <div className="metrics-grid">
        <StatCard label="Today" value={todayAppointments.data.length} tone="warning" />
        <StatCard label="Upcoming" value={upcomingAppointments.data.length} tone="neutral" />
        <StatCard label="Open slots" value={slots.data.filter((slot) => !slot.booked && !slot.blocked).length} tone="success" />
        <StatCard label="Revenue" value={formatCurrency(revenue.data?.totalRevenue || 0)} tone="danger" />
      </div>
      {sectionError ? <div className="state-box state-error">{sectionError}</div> : null}
      <Tabs
        items={[
          { key: "profile", label: "Profile" },
          { key: "availability", label: "Availability" },
          { key: "appointments", label: "Appointments" },
          { key: "records", label: "Records" },
          { key: "revenue", label: "Revenue" },
          { key: "reviews", label: "Reviews" },
          { key: "notifications", label: "Notifications" }
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "profile" ? (
        <SectionCard
          title={profileMissing ? "Register Provider Profile" : "Provider Profile"}
          subtitle="Publish or refine the clinic-facing provider details shown to patients."
          actions={
            !profileMissing ? (
              <button type="button" className="button ghost" onClick={syncAuthProfile}>
                Sync Auth Profile
              </button>
            ) : null
          }
        >
          <DataState
            loading={profileLoading}
            error={profileError}
            data={profileMissing ? {} : providerProfile}
            emptyMessage="Provider profile is not set up yet."
          >
            <div className="provider-profile-layout">
              {!profileMissing && providerProfile ? (
                <div className="info-card provider-summary-card">
                  <div className="provider-summary-head">
                    <div className="avatar-shell large">
                      {providerProfile.fullName?.charAt(0)?.toUpperCase() || "P"}
                    </div>
                    <div className="provider-summary-copy">
                      <div className="meta-row">
                        <span className={classNames("pill", `pill-${statusTone(providerProfile.verified ? "VERIFIED" : "PENDING")}`)}>
                          {providerProfile.verified ? "Verified" : "Awaiting review"}
                        </span>
                        <span className={classNames("pill", `pill-${statusTone(providerProfile.available ? "ACTIVE" : "INACTIVE")}`)}>
                          {providerProfile.available ? "Available" : "Unavailable"}
                        </span>
                      </div>
                      <h3>{providerProfile.fullName}</h3>
                      <p className="provider-summary-specialization">{providerProfile.specialization}</p>
                    </div>
                  </div>
                  <p className="provider-summary-bio">{providerProfile.bio || "No bio yet."}</p>
                  <div className="key-grid provider-summary-grid">
                    <div>
                      <span className="muted">Clinic</span>
                      <strong>{providerProfile.clinicName}</strong>
                    </div>
                    <div>
                      <span className="muted">Address</span>
                      <strong>{providerProfile.clinicAddress}</strong>
                    </div>
                    <div>
                      <span className="muted">Qualification</span>
                      <strong>{providerProfile.qualification}</strong>
                    </div>
                    <div>
                      <span className="muted">Experience</span>
                      <strong>{providerProfile.experienceYears || 0}+ years</strong>
                    </div>
                  </div>
                  <div className="account-actions provider-summary-actions">
                    <button type="button" className="button ghost provider-toggle-button" onClick={() => toggleAvailability(true)}>
                      Set Available
                    </button>
                    <button type="button" className="button ghost danger provider-toggle-button" onClick={() => toggleAvailability(false)}>
                      Set Unavailable
                    </button>
                  </div>
                  {providerProfile.verificationNote ? (
                    <div className="state-box provider-verification-note">
                      Verification note: {providerProfile.verificationNote}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <form className="info-card provider-editor-card" onSubmit={submitProviderProfile}>
                <div className="provider-editor-head">
                  <div>
                    <h3>{profileMissing ? "Create profile" : "Update profile"}</h3>
                    <p>Keep the public-facing information polished, trustworthy, and easy for patients to scan.</p>
                  </div>
                </div>
                <div className="account-form-grid provider-editor-grid">
                  <Field label="Specialization">
                    <input
                      list="provider-specialization-options"
                      value={providerForm.specialization}
                      onChange={(event) =>
                        setProviderForm((current) => ({ ...current, specialization: event.target.value }))
                      }
                      placeholder="Cardiologist, ENT Specialist, Dentist..."
                      required
                    />
                  </Field>
                  <Field label="Qualification">
                    <input
                      list="provider-qualification-options"
                      value={providerForm.qualification}
                      onChange={(event) =>
                        setProviderForm((current) => ({ ...current, qualification: event.target.value }))
                      }
                      placeholder="MBBS, BDS, MD..."
                      required
                    />
                  </Field>
                  <Field label="Experience years">
                    <input
                      type="number"
                      min="0"
                      max="80"
                      value={providerForm.experienceYears}
                      onChange={(event) =>
                        setProviderForm((current) => ({ ...current, experienceYears: event.target.value }))
                      }
                      required
                    />
                  </Field>
                  {profileMissing ? (
                    <Field label="Available now">
                      <select
                        value={String(providerForm.available)}
                        onChange={(event) =>
                          setProviderForm((current) => ({ ...current, available: event.target.value === "true" }))
                        }
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </Field>
                  ) : (
                    <Field label="Profile state" hint="Availability can also be changed from the summary card.">
                      <input value={providerProfile?.available ? "Available" : "Unavailable"} disabled />
                    </Field>
                  )}
                  <Field label="Clinic name">
                    <input
                      value={providerForm.clinicName}
                      onChange={(event) =>
                        setProviderForm((current) => ({ ...current, clinicName: event.target.value }))
                      }
                      required
                    />
                  </Field>
                  <Field label="Clinic address">
                    <input
                      value={providerForm.clinicAddress}
                      onChange={(event) =>
                        setProviderForm((current) => ({ ...current, clinicAddress: event.target.value }))
                      }
                      required
                    />
                  </Field>
                  <Field label="Bio">
                    <textarea
                      rows={4}
                      value={providerForm.bio}
                      onChange={(event) => setProviderForm((current) => ({ ...current, bio: event.target.value }))}
                    />
                  </Field>
                </div>
                <div className="provider-editor-actions">
                  <p className="muted">
                    Patients see this profile before they book, so short, specific details work best.
                  </p>
                  <button type="submit" className="button primary provider-save-button">
                    {profileMissing ? "Register Provider Profile" : "Save Provider Profile"}
                  </button>
                </div>
                <datalist id="provider-specialization-options">
                  {SPECIALIZATION_OPTIONS.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                <datalist id="provider-qualification-options">
                  {QUALIFICATION_OPTIONS.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </form>
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "availability" ? (
        <div className="stack-list">
          {providerReady ? (
            <>
              <div className="availability-layout">
                <form className="info-card availability-form" onSubmit={addSingleSlot}>
                  <div className="availability-form-head">
                    <div>
                      <h3>Add single slot</h3>
                      <p>Publish one exact consultation window for a specific date.</p>
                    </div>
                    <span className="pill pill-neutral">One-time</span>
                  </div>
                  <div className="availability-fields">
                    <Field label="Date">
                      <input
                        type="date"
                        value={singleSlotForm.date}
                        onChange={(event) => setSingleSlotForm((current) => ({ ...current, date: event.target.value }))}
                      />
                    </Field>
                    <Field label="Start time">
                      <input
                        type="time"
                        value={singleSlotForm.startTime}
                        onChange={(event) =>
                          setSingleSlotForm((current) => ({ ...current, startTime: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="End time">
                      <input
                        type="time"
                        value={singleSlotForm.endTime}
                        onChange={(event) => setSingleSlotForm((current) => ({ ...current, endTime: event.target.value }))}
                      />
                    </Field>
                    <Field label="Duration minutes">
                      <input
                        type="number"
                        min="5"
                        value={singleSlotForm.durationMinutes}
                        onChange={(event) =>
                          setSingleSlotForm((current) => ({ ...current, durationMinutes: event.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="availability-submit-row">
                    <p className="muted">Best for one-off availability, special camps, or exceptions.</p>
                    <button type="submit" className="button primary availability-submit-button">
                      Add slot
                    </button>
                  </div>
                </form>

                <form className="info-card availability-form" onSubmit={addRecurringSlots}>
                  <div className="availability-form-head">
                    <div>
                      <h3>Generate recurring slots</h3>
                      <p>Create a repeatable slot pattern across a date range.</p>
                    </div>
                    <span className="pill pill-neutral">Repeating</span>
                  </div>
                  <div className="availability-fields">
                    <Field label="Start date">
                      <input
                        type="date"
                        value={recurringForm.startDate}
                        onChange={(event) =>
                          setRecurringForm((current) => ({ ...current, startDate: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="End date">
                      <input
                        type="date"
                        value={recurringForm.endDate}
                        onChange={(event) =>
                          setRecurringForm((current) => ({ ...current, endDate: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Start time">
                      <input
                        type="time"
                        value={recurringForm.startTime}
                        onChange={(event) =>
                          setRecurringForm((current) => ({ ...current, startTime: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="End time">
                      <input
                        type="time"
                        value={recurringForm.endTime}
                        onChange={(event) =>
                          setRecurringForm((current) => ({ ...current, endTime: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Duration minutes">
                      <input
                        type="number"
                        min="5"
                        value={recurringForm.durationMinutes}
                        onChange={(event) =>
                          setRecurringForm((current) => ({ ...current, durationMinutes: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Pattern">
                      <select
                        value={recurringForm.recurrenceType}
                        onChange={(event) =>
                          setRecurringForm((current) => ({ ...current, recurrenceType: event.target.value }))
                        }
                      >
                        {RECURRENCE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {formatEnum(type)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Custom interval days">
                      <input
                        type="number"
                        min="1"
                        value={recurringForm.intervalDays}
                        onChange={(event) =>
                          setRecurringForm((current) => ({ ...current, intervalDays: event.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="availability-days">
                    <span className="availability-group-label">Repeat on</span>
                    <div className="checkbox-grid">
                      {DAYS_OF_WEEK.map((day) => (
                        <label key={day} className="checkbox-chip">
                          <input
                            type="checkbox"
                            checked={recurringForm.daysOfWeek.includes(day)}
                            onChange={(event) =>
                              setRecurringForm((current) => ({
                                ...current,
                                daysOfWeek: event.target.checked
                                  ? [...current.daysOfWeek, day]
                                  : current.daysOfWeek.filter((item) => item !== day)
                              }))
                            }
                          />
                          <span>{formatEnum(day)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="availability-submit-row">
                    <p className="muted">Use weekly or custom patterns to fill your calendar faster.</p>
                    <button type="submit" className="button primary availability-submit-button">
                      Generate slots
                    </button>
                  </div>
                </form>
              </div>

              <SectionCard title="Published Slots" subtitle="Update timings, block leave, or remove unused slots.">
                <DataState
                  loading={slots.loading}
                  error={slots.error}
                  data={slots.data}
                  emptyMessage="No slots published in the next two weeks."
                >
                  <div className="stack-list">
                    {slots.data.map((slot) => (
                      <article key={slot.slotId} className="info-card">
                        <div className="meta-row">
                          <span className={classNames("pill", `pill-${statusTone(slot.blocked ? "FAILED" : slot.booked ? "PENDING" : "ACTIVE")}`)}>
                            {slot.blocked ? "Blocked" : slot.booked ? "Booked" : "Open"}
                          </span>
                          <span className="muted slot-datetime">
                            <span>{formatDate(slot.date)}</span>
                            <span>
                              {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                            </span>
                          </span>
                        </div>
                        <p>{slot.durationMinutes} mins</p>
                        {slot.blockedReason ? <p className="muted">Reason: {slot.blockedReason}</p> : null}
                        <details className="details-card slot-details-card">
                          <summary className="slot-details-summary">Edit slot</summary>
                          <div className="form-grid slot-details-grid">
                            <Field label="Date">
                              <input
                                type="date"
                                value={slotEdits[slot.slotId]?.date || slot.date}
                                onChange={(event) =>
                                  setSlotEdits((current) => ({
                                    ...current,
                                    [slot.slotId]: {
                                      date: event.target.value,
                                      startTime: current[slot.slotId]?.startTime || slot.startTime,
                                      endTime: current[slot.slotId]?.endTime || slot.endTime,
                                      durationMinutes: current[slot.slotId]?.durationMinutes || slot.durationMinutes
                                    }
                                  }))
                                }
                              />
                            </Field>
                            <Field label="Start">
                              <input
                                type="time"
                                value={slotEdits[slot.slotId]?.startTime || slot.startTime}
                                onChange={(event) =>
                                  setSlotEdits((current) => ({
                                    ...current,
                                    [slot.slotId]: {
                                      date: current[slot.slotId]?.date || slot.date,
                                      startTime: event.target.value,
                                      endTime: current[slot.slotId]?.endTime || slot.endTime,
                                      durationMinutes: current[slot.slotId]?.durationMinutes || slot.durationMinutes
                                    }
                                  }))
                                }
                              />
                            </Field>
                            <Field label="End">
                              <input
                                type="time"
                                value={slotEdits[slot.slotId]?.endTime || slot.endTime}
                                onChange={(event) =>
                                  setSlotEdits((current) => ({
                                    ...current,
                                    [slot.slotId]: {
                                      date: current[slot.slotId]?.date || slot.date,
                                      startTime: current[slot.slotId]?.startTime || slot.startTime,
                                      endTime: event.target.value,
                                      durationMinutes: current[slot.slotId]?.durationMinutes || slot.durationMinutes
                                    }
                                  }))
                                }
                              />
                            </Field>
                            <Field label="Duration">
                              <input
                                type="number"
                                min="5"
                                value={slotEdits[slot.slotId]?.durationMinutes || slot.durationMinutes}
                                onChange={(event) =>
                                  setSlotEdits((current) => ({
                                    ...current,
                                    [slot.slotId]: {
                                      date: current[slot.slotId]?.date || slot.date,
                                      startTime: current[slot.slotId]?.startTime || slot.startTime,
                                      endTime: current[slot.slotId]?.endTime || slot.endTime,
                                      durationMinutes: event.target.value
                                    }
                                  }))
                                }
                              />
                            </Field>
                          </div>
                          <button
                            type="button"
                            className="button slot-action-button slot-action-edit slot-details-button"
                            onClick={() => updateSlot(slot.slotId)}
                          >
                            Save slot changes
                          </button>
                        </details>
                        <div className="row-actions">
                          {slot.blocked ? (
                            <button
                              type="button"
                              className="button slot-action-button slot-action-unblock"
                              onClick={() => unblockSlot(slot.slotId)}
                            >
                              Unblock
                            </button>
                          ) : (
                            <details className="details-card slot-details-card slot-block-card">
                              <summary className="slot-details-summary">Block slot</summary>
                              <Field label="Reason">
                                <input
                                  value={blockReasons[slot.slotId] || ""}
                                  onChange={(event) =>
                                    setBlockReasons((current) => ({ ...current, [slot.slotId]: event.target.value }))
                                  }
                                  placeholder="Optional note for leave, break, or emergency"
                                />
                              </Field>
                              <button
                                type="button"
                                className="button slot-action-button slot-action-block slot-details-button"
                                onClick={() => blockSlot(slot.slotId)}
                              >
                                Confirm block
                              </button>
                            </details>
                          )}
                          <button
                            type="button"
                            className="button slot-action-button slot-action-delete"
                            onClick={() => deleteSlot(slot.slotId)}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </DataState>
              </SectionCard>
            </>
          ) : (
            <div className="state-box">
              Create your provider profile in the `Profile` tab first. Once the profile exists, schedule APIs will start working and your slots can be managed here.
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "appointments" ? (
        <div className="stack-list">
          {!providerReady ? (
            <div className="state-box">
              Provider appointments appear only after your provider profile has been registered.
            </div>
          ) : null}
          <SectionCard title="Today's Queue" subtitle="Complete visits and prepare record creation.">
            <DataState
              loading={todayAppointments.loading}
              error={todayAppointments.error}
              data={todayAppointments.data}
              emptyMessage="No appointments scheduled for today."
            >
              <div className="stack-list">
                {todayAppointments.data.map((appointment) => (
                  <article key={appointment.appointmentId} className="info-card">
                    <div className="meta-row">
                      <span className={classNames("pill", `pill-${statusTone(appointment.status)}`)}>
                        {formatEnum(appointment.status)}
                      </span>
                      <span>{formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}</span>
                    </div>
                    <h3>{appointment.serviceType}</h3>
                    <div className="form-grid">
                      <Field label="Completion notes">
                        <input
                          value={completeNotes[appointment.appointmentId] || ""}
                          onChange={(event) =>
                            setCompleteNotes((current) => ({
                              ...current,
                              [appointment.appointmentId]: event.target.value
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <div className="row-actions">
                      {appointment.status !== "COMPLETED" ? (
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => completeAppointment(appointment.appointmentId)}
                        >
                          Mark complete
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => {
                          setRecordForm((current) => ({ ...current, appointmentId: appointment.appointmentId }));
                          setEditingRecordId("");
                          setActiveTab("records");
                        }}
                      >
                        Create record
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>

          <SectionCard title="Upcoming Appointments" subtitle="Keep an eye on the upcoming provider queue.">
            <DataState
              loading={upcomingAppointments.loading}
              error={upcomingAppointments.error}
              data={upcomingAppointments.data}
              emptyMessage="No upcoming appointments."
            >
              <div className="stack-list">
                {upcomingAppointments.data.map((appointment) => (
                  <article key={appointment.appointmentId} className="info-card">
                    <div className="meta-row">
                      <span className={classNames("pill", `pill-${statusTone(appointment.status)}`)}>
                        {formatEnum(appointment.status)}
                      </span>
                      <span className="muted">
                        {formatDate(appointment.appointmentDate)} â€¢ {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
                      </span>
                    </div>
                    <h3>{appointment.serviceType}</h3>
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "records" ? (
        <div className="stack-list">
          {!providerReady ? (
            <div className="state-box">
              Provider medical records are tied to your registered provider profile. Finish profile setup first.
            </div>
          ) : null}
          <SectionCard title={editingRecordId ? "Edit Medical Record" : "Create Medical Record"} subtitle="Attach diagnosis, prescription, and follow-up info to completed visits.">
            <form className="form-grid" onSubmit={submitRecord}>
              <Field label="Appointment ID">
                <input
                  value={recordForm.appointmentId}
                  onChange={(event) => setRecordForm((current) => ({ ...current, appointmentId: event.target.value }))}
                  disabled={Boolean(editingRecordId)}
                  required
                />
              </Field>
              <Field label="Diagnosis">
                <input
                  value={recordForm.diagnosis}
                  onChange={(event) => setRecordForm((current) => ({ ...current, diagnosis: event.target.value }))}
                  required
                />
              </Field>
              <Field label="Prescription">
                <textarea
                  rows={3}
                  value={recordForm.prescription}
                  onChange={(event) =>
                    setRecordForm((current) => ({ ...current, prescription: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="Clinical notes">
                <textarea
                  rows={3}
                  value={recordForm.notes}
                  onChange={(event) => setRecordForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </Field>
              <Field label="Attachment URL">
                <input
                  value={recordForm.attachmentUrl}
                  onChange={(event) =>
                    setRecordForm((current) => ({ ...current, attachmentUrl: event.target.value }))
                  }
                />
              </Field>
              <Field label="Follow-up date">
                <input
                  type="date"
                  value={recordForm.followUpDate}
                  onChange={(event) =>
                    setRecordForm((current) => ({ ...current, followUpDate: event.target.value }))
                  }
                />
              </Field>
              <div className="row-actions">
                <button type="submit" className="button primary">
                  {editingRecordId ? "Save record" : "Create record"}
                </button>
                {editingRecordId ? (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setEditingRecordId("");
                      setRecordForm({
                        appointmentId: "",
                        diagnosis: "",
                        prescription: "",
                        notes: "",
                        attachmentUrl: "",
                        followUpDate: ""
                      });
                    }}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Existing Records" subtitle="Review, edit, or remove records you created.">
            <DataState
              loading={records.loading}
              error={records.error}
              data={records.data}
              emptyMessage="No provider records available."
            >
              <div className="stack-list">
                {records.data.map((record) => (
                  <article key={record.recordId} className="info-card">
                    <div className="meta-row">
                      <span className="pill pill-neutral">Medical record</span>
                      <span className="muted">{formatInstant(record.updatedAt || record.createdAt)}</span>
                    </div>
                    <h3>{record.diagnosis}</h3>
                    <p>{record.prescription}</p>
                    {record.notes ? <p className="muted">{record.notes}</p> : null}
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => {
                          setEditingRecordId(record.recordId);
                          setRecordForm({
                            appointmentId: record.appointmentId,
                            diagnosis: record.diagnosis,
                            prescription: record.prescription,
                            notes: record.notes || "",
                            attachmentUrl: record.attachmentUrl || "",
                            followUpDate: record.followUpDate || ""
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button ghost danger"
                        onClick={() => deleteRecord(record.recordId)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "revenue" ? (
        <SectionCard title="Revenue Analytics" subtitle="Track provider collections, pending payments, and monthly totals.">
          {!providerReady ? (
            <div className="state-box">
              Revenue analytics are available after your provider profile exists and payment records are linked to it.
            </div>
          ) : null}
          <DataState
            loading={revenue.loading}
            error={revenue.error}
            data={revenue.data}
            emptyMessage="Revenue summary unavailable."
          >
            <div className="metrics-grid">
              <StatCard label="Total revenue" value={formatCurrency(revenue.data.totalRevenue)} tone="success" />
              <StatCard label="Pending" value={formatCurrency(revenue.data.pendingAmount)} tone="warning" />
              <StatCard label="Refunded" value={formatCurrency(revenue.data.refundedAmount)} tone="danger" />
              <StatCard label="Paid transactions" value={revenue.data.paidTransactionCount} tone="neutral" />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(revenue.data.monthlyBreakdown || []).map((item, index) => (
                    <tr key={index}>
                      <td>
                        {item.year}-{String(item.month).padStart(2, "0")}
                      </td>
                      <td>{formatCurrency(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "reviews" ? (
        <SectionCard title="Patient Reviews" subtitle="Monitor sentiment and flag inappropriate content for admin moderation.">
          <DataState
            loading={reviews.loading}
            error={reviews.error}
            data={reviews.data}
            emptyMessage="No reviews available for this provider yet."
          >
            <div className="stack-list">
              {reviews.data.map((review) => (
                <article key={review.reviewId} className="info-card">
                  <div className="meta-row">
                    <span className="pill pill-warning">{review.rating} / 5</span>
                    <span className="muted">{formatInstant(review.reviewDate)}</span>
                  </div>
                  <h3>Appointment review</h3>
                  <p>{review.comment || "No written comment."}</p>
                  {review.flagged ? <p className="muted">Already flagged: {review.flagReason}</p> : null}
                  {!review.flagged ? (
                    <details className="details-card">
                      <summary>Flag review</summary>
                      <Field label="Reason">
                        <input
                          value={flagReasons[review.reviewId] || ""}
                          onChange={(event) =>
                            setFlagReasons((current) => ({ ...current, [review.reviewId]: event.target.value }))
                          }
                        />
                      </Field>
                      <button type="button" className="button ghost danger" onClick={() => flagReview(review.reviewId)}>
                        Submit flag
                      </button>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "notifications" ? (
        <NotificationFeed
          notifications={notifications.data}
          loading={notifications.loading}
          error={notifications.error}
          onRead={markNotificationRead}
          onDelete={deleteNotification}
          onReadAll={markAllNotificationsRead}
        />
      ) : null}
    </SectionCard>
  );
}

function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("users");
  const [refreshKey, setRefreshKey] = useState(0);
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [providerVerifiedFilter, setProviderVerifiedFilter] = useState("false");
  const [appointmentStatusFilter, setAppointmentStatusFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");
  const [reviewFlaggedOnly, setReviewFlaggedOnly] = useState(false);
  const [statusNotes, setStatusNotes] = useState({});
  const [paymentNotes, setPaymentNotes] = useState({});
  const [paymentStatuses, setPaymentStatuses] = useState({});
  const [providerDecision, setProviderDecision] = useState({});
  const [providerNote, setProviderNote] = useState({});
  const [bulkForm, setBulkForm] = useState({
    audience: "ALL",
    type: "BROADCAST",
    title: "",
    message: "",
    channels: ["APP"],
    relatedId: "",
    relatedType: ""
  });
  const [sectionError, setSectionError] = useState("");
  const [sectionSuccess, setSectionSuccess] = useState("");

  const users = useApiResource([], [refreshKey, userRoleFilter], () =>
    apiRequest(`/api/v1/auth/admin/users${buildQuery({ role: userRoleFilter || undefined })}`)
  );
  const providers = useApiResource([], [refreshKey, providerVerifiedFilter], () =>
    apiRequest(
      `/api/v1/providers/all${buildQuery({
        verified: providerVerifiedFilter === "all" ? undefined : providerVerifiedFilter
      })}`
    )
  );
  const appointments = useApiResource([], [refreshKey, appointmentStatusFilter], () =>
    apiRequest(`/api/v1/appointments/admin${buildQuery({ status: appointmentStatusFilter || undefined })}`)
  );
  const payments = useApiResource([], [refreshKey, paymentStatusFilter], () =>
    apiRequest(`/api/v1/payments/history${buildQuery({ status: paymentStatusFilter || undefined })}`)
  );
  const revenue = useApiResource(null, [refreshKey], () => apiRequest("/api/v1/payments/admin/revenue"));
  const reviews = useApiResource([], [refreshKey, reviewFlaggedOnly], () =>
    apiRequest(`/api/v1/reviews${buildQuery({ flagged: reviewFlaggedOnly || undefined })}`)
  );
  const notifications = useApiResource([], [refreshKey], () => apiRequest("/api/v1/notifications"));
  const specializationCounts = useApiResource([], [refreshKey], () =>
    apiRequest("/api/v1/providers/admin/specialization-counts")
  );

  async function refreshAll() {
    setRefreshKey((value) => value + 1);
  }

  async function updateUserStatus(userId, active) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/auth/admin/users/${userId}/status`, {
        method: "PATCH",
        body: {
          active
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function reviewProvider(providerId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/providers/${providerId}/verify`, {
        method: "PUT",
        body: {
          verified: providerDecision[providerId] === "true",
          verificationNote: providerNote[providerId] || null
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function refundPayment(paymentId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/payments/${paymentId}/refund`, {
        method: "POST",
        body: {
          reason: paymentNotes[paymentId] || null
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function updatePaymentStatus(paymentId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/payments/${paymentId}/status`, {
        method: "PUT",
        body: {
          status: paymentStatuses[paymentId] || "PENDING",
          notes: paymentNotes[paymentId] || null
        }
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function deleteReview(reviewId) {
    try {
      setSectionError("");
      await apiRequest(`/api/v1/reviews/${reviewId}`, {
        method: "DELETE"
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  async function sendBulkNotification(event) {
    event.preventDefault();
    try {
      setSectionError("");
      setSectionSuccess("");
      const response = await apiRequest("/api/v1/notifications/bulk", {
        method: "POST",
        body: {
          ...bulkForm
        }
      });
      setSectionSuccess(
        `Bulk notification sent to ${response.recipientCount} recipients across ${response.notificationCount} dispatches.`
      );
      setBulkForm({
        audience: "ALL",
        type: "BROADCAST",
        title: "",
        message: "",
        channels: ["APP"],
        relatedId: "",
        relatedType: ""
      });
      refreshAll();
    } catch (error) {
      setSectionError(getErrorMessage(error));
    }
  }

  return (
    <SectionCard title="Admin Dashboard" subtitle="Moderate the platform, verify providers, and track operational health.">
      <div className="metrics-grid">
        <StatCard label="Users" value={users.data.length} tone="neutral" />
        <StatCard label="Pending providers" value={providers.data.filter((item) => !item.verified).length} tone="warning" />
        <StatCard label="Payments" value={payments.data.length} tone="success" />
        <StatCard label="Revenue" value={formatCurrency(revenue.data?.totalRevenue || 0)} tone="danger" />
      </div>
      {sectionError ? <div className="state-box state-error">{sectionError}</div> : null}
      {sectionSuccess ? <div className="state-box state-success">{sectionSuccess}</div> : null}
      <Tabs
        items={[
          { key: "users", label: "Users" },
          { key: "providers", label: "Providers" },
          { key: "appointments", label: "Appointments" },
          { key: "payments", label: "Payments" },
          { key: "reviews", label: "Reviews" },
          { key: "notifications", label: "Notifications" },
          { key: "analytics", label: "Analytics" }
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "users" ? (
        <SectionCard title="User Management" subtitle="Activate or suspend user accounts by role.">
          <div className="toolbar">
            <Field label="Filter role">
              <select value={userRoleFilter} onChange={(event) => setUserRoleFilter(event.target.value)}>
                <option value="">All roles</option>
                <option value="PATIENT">Patient</option>
                <option value="PROVIDER">Provider</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
          </div>
          <DataState loading={users.loading} error={users.error} data={users.data} emptyMessage="No users found.">
            <div className="stack-list">
              {users.data.map((user) => (
                <article key={user.userId} className="info-card">
                  <div className="meta-row">
                    <span className="pill pill-neutral">{formatEnum(user.role)}</span>
                    <span className={classNames("pill", `pill-${statusTone(user.active ? "ACTIVE" : "INACTIVE")}`)}>
                      {user.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <h3>{user.fullName}</h3>
                  <p>{user.email}</p>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => updateUserStatus(user.userId, !user.active)}
                    >
                      {user.active ? "Suspend" : "Reactivate"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "providers" ? (
        <SectionCard title="Provider Verification" subtitle="Approve or reject submitted provider profiles.">
          <div className="toolbar">
            <Field label="Verification filter">
              <select
                value={providerVerifiedFilter}
                onChange={(event) => setProviderVerifiedFilter(event.target.value)}
              >
                <option value="false">Pending verification</option>
                <option value="true">Verified</option>
                <option value="all">All providers</option>
              </select>
            </Field>
          </div>
          <DataState
            loading={providers.loading}
            error={providers.error}
            data={providers.data}
            emptyMessage="No providers found."
          >
            <div className="stack-list">
              {providers.data.map((provider) => (
                <article key={provider.providerId} className="info-card">
                  <div className="meta-row">
                    <span className={classNames("pill", `pill-${statusTone(provider.verified ? "VERIFIED" : "PENDING")}`)}>
                      {provider.verified ? "Verified" : "Pending"}
                    </span>
                    <span>{provider.specialization}</span>
                  </div>
                  <h3>{provider.fullName}</h3>
                  <p>{provider.clinicName}</p>
                  <div className="form-grid">
                    <Field label="Decision">
                      <select
                        value={providerDecision[provider.providerId] || String(provider.verified)}
                        onChange={(event) =>
                          setProviderDecision((current) => ({
                            ...current,
                            [provider.providerId]: event.target.value
                          }))
                        }
                      >
                        <option value="true">Verify</option>
                        <option value="false">Reject / unverify</option>
                      </select>
                    </Field>
                    <Field label="Verification note">
                      <input
                        value={providerNote[provider.providerId] || provider.verificationNote || ""}
                        onChange={(event) =>
                          setProviderNote((current) => ({
                            ...current,
                            [provider.providerId]: event.target.value
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <button type="button" className="button primary" onClick={() => reviewProvider(provider.providerId)}>
                    Save decision
                  </button>
                </article>
              ))}
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "appointments" ? (
        <SectionCard title="Platform Appointments" subtitle="Observe appointment volume and lifecycle status across the platform.">
          <div className="toolbar">
            <Field label="Status">
              <select
                value={appointmentStatusFilter}
                onChange={(event) => setAppointmentStatusFilter(event.target.value)}
              >
                <option value="">All statuses</option>
                {APPOINTMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {formatEnum(status)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <DataState
            loading={appointments.loading}
            error={appointments.error}
            data={appointments.data}
            emptyMessage="No appointments found."
          >
            <div className="stack-list">
              {appointments.data.map((appointment) => (
                <article key={appointment.appointmentId} className="info-card">
                  <div className="meta-row">
                    <span className={classNames("pill", `pill-${statusTone(appointment.status)}`)}>
                      {formatEnum(appointment.status)}
                    </span>
                    <span>{formatDate(appointment.appointmentDate)}</span>
                  </div>
                  <h3>{appointment.serviceType}</h3>
                  <p>Scheduled consultation</p>
                </article>
              ))}
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "payments" ? (
        <div className="stack-list">
          <SectionCard title="Platform Revenue" subtitle="High-level payment health and reconciliation snapshot.">
            <DataState loading={revenue.loading} error={revenue.error} data={revenue.data} emptyMessage="Revenue data unavailable.">
              <div className="metrics-grid">
                <StatCard label="Total revenue" value={formatCurrency(revenue.data.totalRevenue)} tone="success" />
                <StatCard label="Pending amount" value={formatCurrency(revenue.data.pendingAmount)} tone="warning" />
                <StatCard label="Refunded amount" value={formatCurrency(revenue.data.refundedAmount)} tone="danger" />
                <StatCard label="Paid txns" value={revenue.data.paidTransactionCount} tone="neutral" />
              </div>
            </DataState>
          </SectionCard>

          <SectionCard title="Payment Transactions" subtitle="Refund or update transaction status when needed.">
            <div className="toolbar">
              <Field label="Status">
                <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)}>
                  <option value="">All statuses</option>
                  {PAYMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatEnum(status)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <DataState loading={payments.loading} error={payments.error} data={payments.data} emptyMessage="No payments found.">
              <div className="stack-list">
                {payments.data.map((payment) => (
                  <article key={payment.paymentId} className="info-card">
                    <div className="meta-row">
                      <span className={classNames("pill", `pill-${statusTone(payment.status)}`)}>
                        {formatEnum(payment.status)}
                      </span>
                      <span>{formatCurrency(payment.amount, payment.currency || "INR")}</span>
                    </div>
                    <h3>Payment transaction</h3>
                    <p>{formatEnum(payment.mode)}</p>
                    <div className="form-grid">
                      <Field label="New status">
                        <select
                          value={paymentStatuses[payment.paymentId] || payment.status}
                          onChange={(event) =>
                            setPaymentStatuses((current) => ({
                              ...current,
                              [payment.paymentId]: event.target.value
                            }))
                          }
                        >
                          {PAYMENT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {formatEnum(status)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Admin notes / refund reason">
                        <input
                          value={paymentNotes[payment.paymentId] || ""}
                          onChange={(event) =>
                            setPaymentNotes((current) => ({
                              ...current,
                              [payment.paymentId]: event.target.value
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => updatePaymentStatus(payment.paymentId)}
                      >
                        Update status
                      </button>
                      <button
                        type="button"
                        className="button ghost danger"
                        onClick={() => refundPayment(payment.paymentId)}
                      >
                        Refund
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "reviews" ? (
        <SectionCard title="Review Moderation" subtitle="Inspect flagged reviews and remove policy-violating content.">
          <div className="toolbar">
            <Field label="Flagged only">
              <select value={String(reviewFlaggedOnly)} onChange={(event) => setReviewFlaggedOnly(event.target.value === "true")}>
                <option value="false">All reviews</option>
                <option value="true">Flagged only</option>
              </select>
            </Field>
          </div>
          <DataState loading={reviews.loading} error={reviews.error} data={reviews.data} emptyMessage="No reviews found.">
            <div className="stack-list">
              {reviews.data.map((review) => (
                <article key={review.reviewId} className="info-card">
                  <div className="meta-row">
                    <span className="pill pill-warning">{review.rating} / 5</span>
                    {review.flagged ? <span className="pill pill-danger">Flagged</span> : null}
                  </div>
                  <h3>Review {review.reviewId}</h3>
                  <p>{review.comment || "No written comment."}</p>
                  {review.flagReason ? <p className="muted">Flag reason: {review.flagReason}</p> : null}
                  <button type="button" className="button ghost danger" onClick={() => deleteReview(review.reviewId)}>
                    Delete review
                  </button>
                </article>
              ))}
            </div>
          </DataState>
        </SectionCard>
      ) : null}

      {activeTab === "notifications" ? (
        <div className="stack-list">
          <SectionCard title="Broadcast Notification" subtitle="Send platform-wide announcements to patients, providers, or everyone.">
            <form className="form-grid" onSubmit={sendBulkNotification}>
              <Field label="Audience">
                <select
                  value={bulkForm.audience}
                  onChange={(event) => setBulkForm((current) => ({ ...current, audience: event.target.value }))}
                >
                  {BROADCAST_AUDIENCES.map((audience) => (
                    <option key={audience} value={audience}>
                      {formatEnum(audience)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Notification type">
                <select
                  value={bulkForm.type}
                  onChange={(event) => setBulkForm((current) => ({ ...current, type: event.target.value }))}
                >
                  {NOTIFICATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {formatEnum(type)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Title">
                <input
                  value={bulkForm.title}
                  onChange={(event) => setBulkForm((current) => ({ ...current, title: event.target.value }))}
                  required
                />
              </Field>
              <Field label="Message">
                <textarea
                  rows={4}
                  value={bulkForm.message}
                  onChange={(event) => setBulkForm((current) => ({ ...current, message: event.target.value }))}
                  required
                />
              </Field>
              <Field label="Related ID">
                <input
                  value={bulkForm.relatedId}
                  onChange={(event) => setBulkForm((current) => ({ ...current, relatedId: event.target.value }))}
                />
              </Field>
              <Field label="Related Type">
                <input
                  value={bulkForm.relatedType}
                  onChange={(event) => setBulkForm((current) => ({ ...current, relatedType: event.target.value }))}
                />
              </Field>
              <div className="checkbox-grid">
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <label key={channel} className="checkbox-chip">
                    <input
                      type="checkbox"
                      checked={bulkForm.channels.includes(channel)}
                      onChange={(event) =>
                        setBulkForm((current) => ({
                          ...current,
                          channels: event.target.checked
                            ? [...current.channels, channel]
                            : current.channels.filter((item) => item !== channel)
                        }))
                      }
                    />
                    <span>{formatEnum(channel)}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="button primary">
                Send notification
              </button>
            </form>
          </SectionCard>

          <SectionCard title="Notification Log" subtitle="Recent notifications sent across the platform.">
            <DataState
              loading={notifications.loading}
              error={notifications.error}
              data={notifications.data}
              emptyMessage="No notifications found."
            >
              <div className="stack-list">
                {notifications.data.map((notification) => (
                  <article key={notification.notificationId} className="info-card">
                    <div className="meta-row">
                      <span className="pill pill-neutral">{formatEnum(notification.type)}</span>
                      <span>{formatInstant(notification.sentAt)}</span>
                    </div>
                    <h3>{notification.title}</h3>
                    <p>{notification.message}</p>
                    <span className="muted">{formatEnum(notification.channel)}</span>
                  </article>
                ))}
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "analytics" ? (
        <div className="stack-list">
          <SectionCard title="Specialization Demand" subtitle="Top provider specialization counts across the platform.">
            <DataState
              loading={specializationCounts.loading}
              error={specializationCounts.error}
              data={specializationCounts.data}
              emptyMessage="Specialization counts unavailable."
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Specialization</th>
                      <th>Providers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specializationCounts.data.map((item) => (
                      <tr key={item.specialization}>
                        <td>{item.specialization}</td>
                        <td>{item.providerCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataState>
          </SectionCard>

          <SectionCard title="Monthly Revenue Breakdown" subtitle="Revenue distribution by month from the payment service.">
            <DataState loading={revenue.loading} error={revenue.error} data={revenue.data} emptyMessage="Revenue data unavailable.">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(revenue.data.monthlyBreakdown || []).map((item, index) => (
                      <tr key={index}>
                        <td>
                          {item.year}-{String(item.month).padStart(2, "0")}
                        </td>
                        <td>{formatCurrency(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataState>
          </SectionCard>
        </div>
      ) : null}
    </SectionCard>
  );
}

export default function App() {
  const [authState, setAuthState] = usePersistentState("medibook-auth", null);
  const [themeMode, setThemeMode] = usePersistentState("medibook-theme", "light");
  const authStateRef = useRef(authState);
  const initialSessionRef = useRef(authState);
  const [authReady, setAuthReady] = useState(() => !initialSessionRef.current?.accessToken);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode || "light";
  }, [themeMode]);

  useEffect(() => {
    bindAuthHandlers({
      getAuthState: () => authStateRef.current,
      updateAuthState: (response) => setAuthState(normalizeAuthResponse(response)),
      clearAuthState: () => setAuthState(null)
    });
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrapStoredSession() {
      if (!initialSessionRef.current?.accessToken) {
        if (active) {
          setAuthReady(true);
        }
        return;
      }

      try {
        if (initialSessionRef.current.refreshToken) {
          await refreshAuthSession();
        } else {
          const user = await apiRequest("/api/v1/auth/profile");
          if (active) {
            setAuthState((current) => (current ? { ...current, user } : current));
          }
        }
      } catch (error) {
        if (active) {
          setAuthState(null);
          setNotice({ message: "Your saved session is no longer valid. Please sign in again." });
        }
      } finally {
        if (active) {
          setAuthReady(true);
        }
      }
    }

    bootstrapStoredSession();

    return () => {
      active = false;
    };
  }, [setAuthState]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [notice]);

  async function login(payload) {
    const response = await apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: payload
    });
    setAuthState(normalizeAuthResponse(response));
    setAuthReady(true);
    setNotice({ message: "Logged in successfully." });
  }

  async function register(payload) {
    const response = await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: payload
    });
    setAuthState(normalizeAuthResponse(response));
    setAuthReady(true);
    setNotice({ message: "Account created successfully." });
  }

  async function completeOAuthLogin(tokens) {
    const user = await apiRequest("/api/v1/auth/profile", {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`
      }
    });

    setAuthState({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: "Bearer",
      expiresIn: null,
      user
    });
    setAuthReady(true);
    setNotice({ message: "Signed in with Google." });
  }

  async function logout(noticeMessage = "Logged out.") {
    try {
      await apiRequest("/api/v1/auth/logout", {
        method: "POST"
      });
    } catch (error) {
      // Clear the local session even if the backend logout call fails.
    } finally {
      setAuthState(null);
      setNotice({ message: noticeMessage });
    }
  }

  function mergeUser(user) {
    setAuthState((current) => (current ? { ...current, user } : current));
  }

  const authValue = {
    authState,
    ready: authReady,
    user: authState?.user || null,
    login,
    register,
    completeOAuthLogin,
    logout,
    mergeUser
  };

  return (
    <AuthContext.Provider value={authValue}>
      <AppErrorBoundary>
        <AppShell
          notice={notice}
          onClearNotice={() => setNotice(null)}
          themeMode={themeMode || "light"}
          onToggleTheme={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/oauth2/redirect" element={<OAuthRedirectPage />} />
            <Route path="/providers/:providerId" element={<ProviderDetailPage />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </AppErrorBoundary>
    </AuthContext.Provider>
  );
}

import { transformAsync } from "@babel/core";
import * as t from "@babel/types";
import { fileURLToPath } from "node:url";

const reactAliasPath = fileURLToPath(new URL("../.vite-local/react.js", import.meta.url));
const reactDomClientAliasPath = fileURLToPath(new URL("../.vite-local/react-dom-client.js", import.meta.url));
const reactRouterDomAliasPath = fileURLToPath(new URL("../.vite-local/react-router-dom.js", import.meta.url));

function isComponentTag(name) {
  return /^[A-Z]/.test(name);
}

function jsxNameToExpression(name) {
  if (t.isJSXIdentifier(name)) {
    return isComponentTag(name.name)
      ? t.identifier(name.name)
      : t.stringLiteral(name.name);
  }

  if (t.isJSXMemberExpression(name)) {
    return t.memberExpression(
      jsxNameToMemberObject(name.object),
      jsxNameToMemberProperty(name.property)
    );
  }

  if (t.isJSXNamespacedName(name)) {
    return t.stringLiteral(`${name.namespace.name}:${name.name.name}`);
  }

  return t.stringLiteral("unknown");
}

function jsxNameToMemberObject(node) {
  if (t.isJSXIdentifier(node)) {
    return t.identifier(node.name);
  }

  if (t.isJSXMemberExpression(node)) {
    return t.memberExpression(
      jsxNameToMemberObject(node.object),
      jsxNameToMemberProperty(node.property)
    );
  }

  return t.identifier("undefined");
}

function jsxNameToMemberProperty(node) {
  return t.identifier(node.name);
}

function normalizeJsxText(value) {
  const lines = value.replace(/\r/g, "").split("\n");
  const normalized = lines
    .map((line) => line.replace(/\t/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  return normalized ? t.stringLiteral(normalized) : null;
}

function jsxAttributeValueToExpression(value) {
  if (value == null) {
    return t.booleanLiteral(true);
  }

  if (t.isStringLiteral(value)) {
    return value;
  }

  if (t.isJSXExpressionContainer(value)) {
    return t.isJSXEmptyExpression(value.expression) ? t.booleanLiteral(true) : value.expression;
  }

  return value;
}

function buildProps(attributes) {
  if (!attributes.length) {
    return t.nullLiteral();
  }

  const segments = [];
  let currentProps = [];

  const flushCurrentProps = () => {
    if (currentProps.length > 0) {
      segments.push(t.objectExpression(currentProps));
      currentProps = [];
    }
  };

  for (const attribute of attributes) {
    if (t.isJSXSpreadAttribute(attribute)) {
      flushCurrentProps();
      segments.push(attribute.argument);
      continue;
    }

    const key = t.isValidIdentifier(attribute.name.name)
      ? t.identifier(attribute.name.name)
      : t.stringLiteral(attribute.name.name);
    const value = jsxAttributeValueToExpression(attribute.value);
    currentProps.push(t.objectProperty(key, value));
  }

  flushCurrentProps();

  if (segments.length === 0) {
    return t.nullLiteral();
  }

  if (segments.length === 1 && t.isObjectExpression(segments[0])) {
    return segments[0];
  }

  return t.callExpression(
    t.memberExpression(t.identifier("Object"), t.identifier("assign")),
    [t.objectExpression([]), ...segments]
  );
}

function jsxChildToExpression(child) {
  if (t.isJSXText(child)) {
    return normalizeJsxText(child.value);
  }

  if (t.isJSXExpressionContainer(child)) {
    return t.isJSXEmptyExpression(child.expression) ? null : child.expression;
  }

  if (t.isJSXSpreadChild(child)) {
    return child.expression;
  }

  if (t.isJSXElement(child)) {
    return buildJsxElement(child);
  }

  if (t.isJSXFragment(child)) {
    return buildJsxFragment(child);
  }

  return null;
}

function buildChildren(children) {
  return children.map(jsxChildToExpression).filter(Boolean);
}

function buildJsxElement(node) {
  return t.callExpression(
    t.memberExpression(t.identifier("React"), t.identifier("createElement")),
    [
      jsxNameToExpression(node.openingElement.name),
      buildProps(node.openingElement.attributes),
      ...buildChildren(node.children)
    ]
  );
}

function buildJsxFragment(node) {
  return t.callExpression(
    t.memberExpression(t.identifier("React"), t.identifier("createElement")),
    [
      t.memberExpression(t.identifier("React"), t.identifier("Fragment")),
      t.nullLiteral(),
      ...buildChildren(node.children)
    ]
  );
}

function jsxToReactCreateElementPlugin() {
  return {
    name: "local-jsx-to-react-create-element",
    visitor: {
      JSXFragment(path) {
        path.replaceWith(buildJsxFragment(path.node));
      },
      JSXElement(path) {
        path.replaceWith(buildJsxElement(path.node));
      }
    }
  };
}

function localJsxBabelPlugin() {
  return {
    name: "local-vite-jsx-babel",
    enforce: "pre",
    async transform(code, id) {
      const [filepath] = id.split("?");

      if (filepath.includes("/node_modules/") || !/\.[jt]sx?$/.test(filepath)) {
        return null;
      }

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename: id,
        sourceFileName: filepath,
        sourceMaps: true,
        parserOpts: {
          sourceType: "module",
          allowAwaitOutsideFunction: true,
          plugins: filepath.endsWith(".ts") || filepath.endsWith(".tsx")
            ? ["jsx", "typescript"]
            : ["jsx"]
        },
        plugins: [jsxToReactCreateElementPlugin]
      });

      if (!result) {
        return null;
      }

      return {
        code: result.code,
        map: result.map
      };
    }
  };
}

export function createInlineViteConfig() {
  return {
    configFile: false,
    esbuild: false,
    plugins: [localJsxBabelPlugin()],
    resolve: {
      alias: [
        { find: /^react-dom\/client$/, replacement: reactDomClientAliasPath },
        { find: /^react-router-dom$/, replacement: reactRouterDomAliasPath },
        { find: /^react$/, replacement: reactAliasPath }
      ]
    },
    server: {
      host: "0.0.0.0",
      port: 5173
    },
    preview: {
      host: "0.0.0.0",
      port: 4173
    },
    optimizeDeps: {
      noDiscovery: true,
      include: []
    },
    build: {
      outDir: "dist",
      minify: false,
      target: "esnext"
    }
  };
}

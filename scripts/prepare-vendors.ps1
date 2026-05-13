$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$esbuild = Join-Path $root "node_modules\@esbuild\win32-x64\esbuild.exe"

Push-Location $root
try {
  New-Item -ItemType Directory -Force -Path ".vite-local" | Out-Null

  & $esbuild @(
    "node_modules/react/index.js",
    "--bundle",
    "--format=esm",
    "--platform=browser",
    '--banner:js=const development = String.fromCharCode(100,101,118,101,108,111,112,109,101,110,116); const process = { env: { NODE_ENV: development } };',
    "--outfile=.vite-local/react.js"
  )
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  & $esbuild @(
    "node_modules/react-dom/client.js",
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--external:react",
    '--banner:js=const development = String.fromCharCode(100,101,118,101,108,111,112,109,101,110,116); const process = { env: { NODE_ENV: development } };',
    "--outfile=.vite-local/react-dom-client.js"
  )
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  & $esbuild @(
    "node_modules/react-router-dom/dist/index.js",
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--external:react",
    '--banner:js=const development = String.fromCharCode(100,101,118,101,108,111,112,109,101,110,116); const process = { env: { NODE_ENV: development } };',
    "--outfile=.vite-local/react-router-dom.js"
  )
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Pop-Location
}

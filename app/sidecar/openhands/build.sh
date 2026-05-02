#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECAR_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${SIDECAR_DIR}/dist/openhands"
BUILD_DIR="${SCRIPT_DIR}/.pyinstaller-build"
SPEC_DIR="${SCRIPT_DIR}/.pyinstaller-spec"

if [[ "${OS:-}" == "Windows_NT" ]]; then
  EXE_NAME="openhands-runner.exe"
else
  EXE_NAME="openhands-runner"
fi

PYTHON_BIN="${PYTHON:-}"
if [[ -z "${PYTHON_BIN}" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  else
    PYTHON_BIN="python"
  fi
fi

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "Python 3 is required to build the OpenHands runner." >&2
  echo "Install Python 3, then run: cd app/sidecar/openhands && pip install -r requirements.txt && ./build.sh" >&2
  exit 1
fi

if ! "${PYTHON_BIN}" -c "import PyInstaller" >/dev/null 2>&1; then
  echo "PyInstaller is not installed for ${PYTHON_BIN}." >&2
  echo "Run: cd app/sidecar/openhands && ${PYTHON_BIN} -m pip install -r requirements.txt" >&2
  exit 1
fi

OPENHANDS_SDK_DIR="$("${PYTHON_BIN}" - <<'PY'
import importlib.util
from pathlib import Path

spec = importlib.util.find_spec("openhands.sdk")
if spec is None or spec.origin is None:
    raise SystemExit("openhands.sdk package not found")
print(Path(spec.origin).parent)
PY
)"

if [[ "${OS:-}" == "Windows_NT" ]]; then
  DATA_SEP=";"
else
  DATA_SEP=":"
fi

mkdir -p "${DIST_DIR}" "${BUILD_DIR}" "${SPEC_DIR}"

"${PYTHON_BIN}" -m PyInstaller \
  --onefile \
  --clean \
  --collect-submodules "openhands.tools.browser_use" \
  --collect-data "binaryornot" \
  --collect-data "litellm" \
  --add-data "${OPENHANDS_SDK_DIR}/agent/prompts${DATA_SEP}openhands/sdk/agent/prompts" \
  --add-data "${OPENHANDS_SDK_DIR}/context/condenser/prompts${DATA_SEP}openhands/sdk/context/condenser/prompts" \
  --add-data "${OPENHANDS_SDK_DIR}/context/prompts/templates${DATA_SEP}openhands/sdk/context/prompts/templates" \
  --copy-metadata "binaryornot" \
  --copy-metadata "fastmcp" \
  --copy-metadata "mcp" \
  --copy-metadata "litellm" \
  --copy-metadata "browser-use" \
  --name "openhands-runner" \
  --distpath "${DIST_DIR}" \
  --workpath "${BUILD_DIR}" \
  --specpath "${SPEC_DIR}" \
  --collect-data "binaryornot" \
  --collect-data "litellm" \
  --copy-metadata "binaryornot" \
  --copy-metadata "browser-use" \
  --copy-metadata "fastmcp" \
  --copy-metadata "litellm" \
  --copy-metadata "mcp" \
  "${SCRIPT_DIR}/runner.py"

chmod +x "${DIST_DIR}/${EXE_NAME}" 2>/dev/null || true
echo "Built ${DIST_DIR}/${EXE_NAME}"

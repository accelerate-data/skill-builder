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

PYTHON_BIN="${PYTHON:-python3}"

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

mkdir -p "${DIST_DIR}" "${BUILD_DIR}" "${SPEC_DIR}"

"${PYTHON_BIN}" -m PyInstaller \
  --onefile \
  --clean \
  --name "openhands-runner" \
  --distpath "${DIST_DIR}" \
  --workpath "${BUILD_DIR}" \
  --specpath "${SPEC_DIR}" \
  "${SCRIPT_DIR}/runner.py"

chmod +x "${DIST_DIR}/${EXE_NAME}" 2>/dev/null || true
echo "Built ${DIST_DIR}/${EXE_NAME}"

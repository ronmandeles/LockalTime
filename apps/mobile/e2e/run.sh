#!/usr/bin/env bash
# Phase 7 (Release Prep) Maestro E2E runner. See README.md for prerequisites
# and what these flows do and don't cover.
#
# Usage: ./run.sh [android|ios]   (defaults to android)
set -euo pipefail

PLATFORM="${1:-android}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLOWS_DIR="$SCRIPT_DIR/flows"
FETCH_OTP="$SCRIPT_DIR/scripts/fetch-otp.js"

RUN_ID=$(date +%s)
TEST_HOST_EMAIL="e2e-host-${RUN_ID}@integration.test"
TEST_PARTICIPANT_EMAIL="e2e-participant-${RUN_ID}@integration.test"
TEST_SOLO_EMAIL="e2e-solo-${RUN_ID}@integration.test"

if [ "$PLATFORM" = "ios" ]; then
  DEVICE_FLAG=(--device "iPhone 15")
else
  DEVICE_FLAG=()
fi

echo "== Golden path 1/2: create -> join -> complete =="
maestro test "${DEVICE_FLAG[@]}" -e TEST_HOST_EMAIL="$TEST_HOST_EMAIL" "$FLOWS_DIR/01-host-request-otp.yaml"
HOST_OTP=$(node "$FETCH_OTP" "$TEST_HOST_EMAIL")
maestro test "${DEVICE_FLAG[@]}" -e OTP_CODE="$HOST_OTP" "$FLOWS_DIR/02-host-create-session.yaml"

maestro test "${DEVICE_FLAG[@]}" -e TEST_PARTICIPANT_EMAIL="$TEST_PARTICIPANT_EMAIL" "$FLOWS_DIR/03-participant-request-otp.yaml"
PARTICIPANT_OTP=$(node "$FETCH_OTP" "$TEST_PARTICIPANT_EMAIL")
maestro test "${DEVICE_FLAG[@]}" -e OTP_CODE="$PARTICIPANT_OTP" "$FLOWS_DIR/04-participant-join-and-complete.yaml"

echo "== Golden path 2/2: create -> emergency exit =="
maestro test "${DEVICE_FLAG[@]}" -e TEST_SOLO_EMAIL="$TEST_SOLO_EMAIL" "$FLOWS_DIR/10-solo-request-otp.yaml"
SOLO_OTP=$(node "$FETCH_OTP" "$TEST_SOLO_EMAIL")
maestro test "${DEVICE_FLAG[@]}" -e OTP_CODE="$SOLO_OTP" "$FLOWS_DIR/11-solo-create-and-emergency-exit.yaml"

echo "All E2E flows passed."

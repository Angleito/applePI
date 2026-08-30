#!/usr/bin/env sh
# Select Pi's backend locally so this public repository never carries a
# provider account, token, or vendor-specific model choice.
set -eu

if [ -n "${GC_CITY:-}" ] && [ -f "${GC_CITY}/.env" ]; then
    set -a
    # shellcheck disable=SC1090,SC1091
    . "${GC_CITY}/.env"
    set +a
fi

case "${GC_TEMPLATE:-${GC_AGENT:-}}" in
    *worker)
        model="${APPLEPI_PI_WORKER_MODEL:-gpt-5.6-luna}"
        ;;
    *manager)
        model="${APPLEPI_PI_MANAGER_MODEL:-gpt-5.6-terra}"
        ;;
    *)
        model="${APPLEPI_PI_EXECUTIVE_MODEL:-gpt-5.6-terra}"
        ;;
esac

exec pi --provider "${APPLEPI_PI_PROVIDER:-openai-codex}" --model "${model}" "$@"

#!/usr/bin/env bash
# =============================================================================
# ERP v2 — aplica el esquema completo (db/0*.sql) sobre una base
#
# Crea la base si no existe (ENCODING 'UTF8'), aplica las migraciones en orden
# con ON_ERROR_STOP=1 y para en el primer error mostrándolo.
#
# Uso:
#   export PGPASSWORD=...
#   ./apply.sh minitta_erp
#   ./apply.sh minitta_erp --smoke-test
#   ./apply.sh minitta_erp_test --recreate --smoke-test --drop
#   ./apply.sh minitta_erp --host localhost --port 5433 --user postgres
# =============================================================================
set -euo pipefail

DB=""
PGH="${PGHOST:-localhost}"
PGP="${PGPORT:-5432}"
PGU="${PGUSER:-postgres}"
SMOKE=0
RECREATE=0
DROP=0

usage() {
  sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --smoke-test) SMOKE=1 ;;
    --recreate)   RECREATE=1 ;;
    --drop)       DROP=1 ;;
    --host)       PGH="$2"; shift ;;
    --port)       PGP="$2"; shift ;;
    --user)       PGU="$2"; shift ;;
    -h|--help)    usage 0 ;;
    -*)           echo "Opción desconocida: $1" >&2; usage 2 ;;
    *)            if [ -n "$DB" ]; then echo "Sobra el argumento: $1" >&2; usage 2; fi; DB="$1" ;;
  esac
  shift
done

[ -n "$DB" ] || { echo "Falta el nombre de la base." >&2; usage 2; }
command -v psql >/dev/null 2>&1 || { echo "No se encontró psql en el PATH." >&2; exit 1; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONN=(-h "$PGH" -p "$PGP" -U "$PGU")

# OJO: psql mete varios -c encadenados en UNA transacción, y DROP/CREATE DATABASE
# no pueden correr dentro de una transacción. Por eso cada uno va en su propia
# invocación, siempre con un solo -c.
maintenance() {
  psql "${CONN[@]}" -v ON_ERROR_STOP=1 -d postgres -q -c "$1"
}

db_exists() {
  local out
  out="$(psql "${CONN[@]}" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$DB'")" \
    || { echo "No se pudo conectar a $PGH:$PGP como $PGU." >&2; exit 1; }
  [ "$(echo "$out" | tr -d '[:space:]')" = "1" ]
}

echo
echo "=== ERP v2 — aplicar esquema ==="
echo "    servidor : $PGH:$PGP  (usuario $PGU)"
echo "    base     : $DB"
echo

# --- 1. la base --------------------------------------------------------------
if [ "$RECREATE" -eq 1 ]; then
  echo "[1/3] Recreando la base $DB..."
  maintenance "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);"
  maintenance "CREATE DATABASE \"$DB\" ENCODING 'UTF8';"
elif db_exists; then
  echo "[1/3] La base $DB ya existe."
else
  echo "[1/3] Creando la base $DB..."
  maintenance "CREATE DATABASE \"$DB\" ENCODING 'UTF8';"
fi

# --- 2. migraciones ----------------------------------------------------------
shopt -s nullglob
FILES=("$DIR"/0*.sql)
shopt -u nullglob
[ "${#FILES[@]}" -gt 0 ] || { echo "No hay migraciones (db/0*.sql) en $DIR" >&2; exit 1; }
IFS=$'\n' FILES=($(printf '%s\n' "${FILES[@]}" | sort)); unset IFS

echo
echo "[2/3] Aplicando ${#FILES[@]} migraciones..."
for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  printf '        %-28s' "$name"
  if psql "${CONN[@]}" -v ON_ERROR_STOP=1 -d "$DB" -q -f "$f"; then
    echo 'ok'
  else
    echo 'FALLO'
    echo
    echo "Se cortó en $name. El error de psql está arriba." >&2
    echo "Las migraciones ya aplicadas quedaron. Corregí el archivo y volvé a correr" >&2
    echo "con --recreate para arrancar de una base limpia." >&2
    exit 1
  fi
done

# --- 3. prueba de humo ------------------------------------------------------
SMOKE_FAILED=0
if [ "$SMOKE" -eq 1 ]; then
  echo
  echo '[3/3] Prueba de humo...'
  if psql "${CONN[@]}" -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/999_smoke_test.sql"; then
    echo
    echo 'Prueba de humo OK.'
  else
    echo
    echo 'La prueba de humo falló.' >&2
    SMOKE_FAILED=1
  fi
else
  echo
  echo '[3/3] Prueba de humo omitida (pasá --smoke-test para correrla).'
fi

# --- limpieza opcional ------------------------------------------------------
if [ "$DROP" -eq 1 ]; then
  maintenance "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);"
  echo "Base $DB eliminada (--drop)."
fi

[ "$SMOKE_FAILED" -eq 0 ] || exit 1

echo
echo "Listo: esquema aplicado en $DB."

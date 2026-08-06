\
    #!/usr/bin/env bash
    set -euo pipefail

    usage() {
      cat <<'EOF'
    Usage:
      build-region.sh \
        --input INPUT.osm.pbf \
        --id london \
        --name "London" \
        --country "United Kingdom" \
        --bbox "-0.55,51.25,0.35,51.75" \
        --output public/regions/london

    Requirements:
      osmium-tool
      node
    EOF
    }

    INPUT=""
    REGION_ID=""
    REGION_NAME=""
    COUNTRY=""
    BBOX=""
    OUTPUT=""

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --input) INPUT="$2"; shift 2 ;;
        --id) REGION_ID="$2"; shift 2 ;;
        --name) REGION_NAME="$2"; shift 2 ;;
        --country) COUNTRY="$2"; shift 2 ;;
        --bbox) BBOX="$2"; shift 2 ;;
        --output) OUTPUT="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
      esac
    done

    [[ -n "$INPUT" && -n "$REGION_ID" && -n "$REGION_NAME" && -n "$COUNTRY" && -n "$BBOX" && -n "$OUTPUT" ]] || {
      usage
      exit 2
    }

    command -v osmium >/dev/null || {
      echo "Missing command: osmium" >&2
      exit 1
    }

    command -v node >/dev/null || {
      echo "Missing command: node" >&2
      exit 1
    }

    [[ -f "$INPUT" ]] || {
      echo "Input PBF not found: $INPUT" >&2
      exit 1
    }

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    mkdir -p "$OUTPUT"

    echo "[1/4] Extracting region..."
    osmium extract \
      --bbox "$BBOX" \
      --strategy complete_ways \
      --overwrite \
      --output "$TMP_DIR/region.osm.pbf" \
      "$INPUT"

    echo "[2/4] Filtering POIs..."
    osmium tags-filter \
      --expressions "$SCRIPT_DIR/poi-tags.txt" \
      --overwrite \
      --output "$TMP_DIR/pois.osm.pbf" \
      "$TMP_DIR/region.osm.pbf"

    echo "[3/4] Exporting GeoJSON..."
    osmium export \
      --add-unique-id type_id \
      --overwrite \
      --output "$TMP_DIR/raw-pois.geojson" \
      "$TMP_DIR/pois.osm.pbf"

    echo "[4/4] Normalizing POIs..."
    node "$SCRIPT_DIR/normalize-pois.mjs" \
      --input "$TMP_DIR/raw-pois.geojson" \
      --output "$OUTPUT/pois.geojson" \
      --metadata "$OUTPUT/metadata.json" \
      --id "$REGION_ID" \
      --name "$REGION_NAME" \
      --country "$COUNTRY" \
      --bbox "$BBOX"

    echo
    echo "Region built successfully:"
    echo "  $OUTPUT/metadata.json"
    echo "  $OUTPUT/pois.geojson"

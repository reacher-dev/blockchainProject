import argparse
import csv
import html
import json
from pathlib import Path

import joblib
import numpy as np


FEATURE_COLUMNS = [
    "peak_frequency_hz",
    "peak_magnitude",
    "low_band_energy",
    "speech_band_energy",
    "high_band_energy",
    "low_percent",
    "speech_percent",
    "high_percent",
    "spectral_centroid_hz",
    "spectral_flatness",
    "tonal_peak_ratio",
    "zero_crossing_rate",
]


def load_rows(csv_path):
    rows = []
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        for line_number, row in enumerate(csv.DictReader(handle), start=2):
            try:
                features = [float(row[column]) for column in FEATURE_COLUMNS]
            except (KeyError, TypeError, ValueError):
                continue
            rows.append(
                {
                    "line_number": line_number,
                    "row": row,
                    "features": features,
                }
            )
    return rows


def predict_rows(model_payload, rows):
    model = model_payload["model"]
    labels = list(model.classes_) if hasattr(model, "classes_") else model_payload.get("labels", [])
    results = []

    for item in rows:
        vector = np.asarray([item["features"]], dtype=np.float64)
        predicted = str(model.predict(vector)[0])
        confidence = None
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba(vector)[0]
            confidence = float(max(probabilities))
        actual = item["row"].get("label", "")
        results.append(
            {
                **item,
                "actual": actual,
                "predicted": predicted,
                "confidence": confidence,
                "correct": predicted == actual,
                "labels": labels,
            }
        )
    return results


def relative_audio_path(row, output_dir):
    label = row.get("label", "")
    saved_wav = row.get("saved_wav", "")
    if saved_wav:
        path = Path("training_data") / label / saved_wav
        if path.exists():
            return path.relative_to(output_dir).as_posix()
    return ""


def write_html(output_path, selected, threshold):
    rows_html = []
    output_dir = output_path.parent
    for item in selected:
        row = item["row"]
        audio_path = relative_audio_path(row, output_dir)
        confidence = item["confidence"]
        confidence_text = "-" if confidence is None else f"{confidence:.3f}"
        status = "correct" if item["correct"] else "mismatch"
        label_options = []
        for label in item["labels"]:
            selected_attr = " selected" if label == item["actual"] else ""
            label_options.append(
                f'<option value="{html.escape(label)}"{selected_attr}>{html.escape(label)}</option>'
            )
        audio_html = (
            f'<audio controls src="{html.escape(audio_path)}"></audio>'
            if audio_path
            else '<span class="missing">missing wav</span>'
        )
        rows_html.append(
            f"""
            <tr class="{status}">
                <td>{item["line_number"]}</td>
                <td>
                  <select
                    class="label-select"
                    data-line="{item["line_number"]}"
                    data-old-label="{html.escape(item["actual"])}"
                    data-saved-wav="{html.escape(row.get("saved_wav", ""))}"
                    data-confidence="{confidence_text}"
                  >
                    {''.join(label_options)}
                  </select>
                </td>
                <td>{html.escape(item["predicted"])}</td>
                <td>{confidence_text}</td>
                <td>{html.escape(row.get("source_wav", ""))}</td>
                <td>{audio_html}</td>
            </tr>
            """
        )

    output_path.write_text(
        f"""<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <title>Low Confidence Review</title>
  <style>
    body {{ font-family: Arial, "Noto Sans TC", sans-serif; margin: 24px; background: #f6f6f4; color: #111; }}
    h1 {{ margin-bottom: 6px; }}
    p {{ color: #666; }}
    .toolbar {{ display: flex; gap: 10px; align-items: center; margin: 18px 0; }}
    button {{ border: 1px solid #999; background: #fff; padding: 8px 12px; cursor: pointer; }}
    button:hover {{ background: #eee; }}
    table {{ border-collapse: collapse; width: 100%; background: white; }}
    th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 13px; }}
    th {{ background: #eee; }}
    tr.mismatch {{ background: #fff1f1; }}
    tr.changed {{ outline: 2px solid #0066cc; }}
    select {{ min-width: 170px; padding: 5px; }}
    audio {{ width: 280px; }}
    .missing {{ color: #b00020; }}
    #status {{ color: #333; }}
  </style>
</head>
<body>
  <h1>Low Confidence Review</h1>
  <p>Showing rows with confidence below {threshold}, plus model mismatches. Change wrong labels, or export all visible rows as reviewed if you confirmed they are correct.</p>
  <div class="toolbar">
    <button type="button" id="exportCorrections">Export corrections JSON</button>
    <button type="button" id="exportReviewed">Export all visible as reviewed</button>
    <span id="status">No label changes yet.</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>CSV line</th>
        <th>label</th>
        <th>model prediction</th>
        <th>confidence</th>
        <th>source_wav</th>
        <th>audio</th>
      </tr>
    </thead>
    <tbody>
      {''.join(rows_html)}
    </tbody>
  </table>
  <script>
    const selects = Array.from(document.querySelectorAll(".label-select"));
    const status = document.getElementById("status");

    function getCorrections() {{
      return selects
        .filter((select) => select.value !== select.dataset.oldLabel)
        .map((select) => ({{
          line_number: Number(select.dataset.line),
          old_label: select.dataset.oldLabel,
          new_label: select.value,
          saved_wav: select.dataset.savedWav,
          label_confidence: 3.0
        }}));
    }}

    function getReviewedItems() {{
      return selects.map((select) => ({{
        line_number: Number(select.dataset.line),
        old_label: select.dataset.oldLabel,
        new_label: select.value,
        saved_wav: select.dataset.savedWav,
        model_confidence: select.dataset.confidence,
        label_confidence: 3.0
      }}));
    }}

    function updateStatus() {{
      const corrections = getCorrections();
      status.textContent = corrections.length
        ? `${{corrections.length}} label change(s) ready to export.`
        : "No label changes yet.";
    }}

    selects.forEach((select) => {{
      select.addEventListener("change", () => {{
        select.closest("tr").classList.toggle("changed", select.value !== select.dataset.oldLabel);
        updateStatus();
      }});
    }});

    document.getElementById("exportCorrections").addEventListener("click", () => {{
      const corrections = getCorrections();
      const payload = {{
        generated_at: new Date().toISOString(),
        note: "Apply with: python hardware/apply_label_corrections.py --corrections PATH_TO_THIS_JSON",
        corrections
      }};
      const blob = new Blob([JSON.stringify(payload, null, 2)], {{ type: "application/json" }});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "label_corrections.json";
      link.click();
      URL.revokeObjectURL(url);
    }});

    document.getElementById("exportReviewed").addEventListener("click", () => {{
      const confirmations = getReviewedItems();
      const payload = {{
        generated_at: new Date().toISOString(),
        note: "These visible low-confidence rows were reviewed by a human and should receive higher training weight.",
        confirmations
      }};
      const blob = new Blob([JSON.stringify(payload, null, 2)], {{ type: "application/json" }});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "reviewed_low_confidence.json";
      link.click();
      URL.revokeObjectURL(url);
    }});
  </script>
</body>
</html>
""",
        encoding="utf-8",
    )


def write_reviewed_json(output_path, selected):
    confirmations = []
    for item in selected:
        row = item["row"]
        confirmations.append(
            {
                "line_number": item["line_number"],
                "old_label": item["actual"],
                "new_label": item["actual"],
                "saved_wav": row.get("saved_wav", ""),
                "model_prediction": item["predicted"],
                "model_confidence": item["confidence"],
                "label_confidence": 3.0,
            }
        )

    output_path.write_text(
        json.dumps(
            {
                "note": "Visible low-confidence review rows confirmed as correctly labeled.",
                "confirmations": confirmations,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser(description="Generate an HTML page for low-confidence training samples.")
    parser.add_argument("--csv", default="training_data/labels.csv")
    parser.add_argument("--model", default="training_data/noise_model.joblib")
    parser.add_argument("--output", default="training_data/low_confidence_review.html")
    parser.add_argument("--reviewed-json", default="")
    parser.add_argument("--threshold", type=float, default=0.7)
    parser.add_argument("--limit", type=int, default=80)
    args = parser.parse_args()

    csv_path = Path(args.csv)
    model_path = Path(args.model)
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")
    if not model_path.exists():
        raise SystemExit(f"Model not found: {model_path}")

    rows = load_rows(csv_path)
    payload = joblib.load(model_path)
    predictions = predict_rows(payload, rows)
    selected = [
        item for item in predictions
        if (item["confidence"] is not None and item["confidence"] < args.threshold) or not item["correct"]
    ]
    selected.sort(key=lambda item: (item["correct"], item["confidence"] if item["confidence"] is not None else 1.0))
    selected = selected[: args.limit]

    output_path = Path(args.output)
    write_html(output_path, selected, args.threshold)
    if args.reviewed_json:
        write_reviewed_json(Path(args.reviewed_json), selected)

    print("Rows scanned:", len(rows))
    print("Rows selected:", len(selected))
    print("Review page:", output_path)
    if args.reviewed_json:
        print("Reviewed JSON:", args.reviewed_json)


if __name__ == "__main__":
    main()

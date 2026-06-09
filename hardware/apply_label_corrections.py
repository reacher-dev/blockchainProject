import argparse
import csv
import json
from pathlib import Path


REVIEW_NOTE = "reviewed_low_confidence"
DEFAULT_REVIEWED_WEIGHT = 3.0


def load_corrections(path):
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if isinstance(payload, list):
        corrections = payload
        confirmations = []
    else:
        corrections = payload.get("corrections", [])
        confirmations = payload.get("confirmations", [])

    if not isinstance(corrections, list) or not isinstance(confirmations, list):
        raise ValueError("Corrections file must contain corrections/confirmations lists")

    by_line = {}
    for item in confirmations:
        line_number = int(item["line_number"])
        new_label = str(item.get("new_label") or item.get("confirmed_label") or item.get("old_label") or "").strip()
        if not new_label:
            raise ValueError(f"Empty new_label for line {line_number}")
        by_line[line_number] = {
            "new_label": new_label,
            "label_confidence": str(item.get("label_confidence", DEFAULT_REVIEWED_WEIGHT)),
        }

    for item in corrections:
        line_number = int(item["line_number"])
        new_label = str(item.get("new_label") or "").strip()
        if not new_label:
            raise ValueError(f"Empty new_label for line {line_number}")
        by_line[line_number] = {
            "new_label": new_label,
            "label_confidence": str(item.get("label_confidence", DEFAULT_REVIEWED_WEIGHT)),
        }
    return by_line


def append_note(existing_note):
    note = (existing_note or "").strip()
    if REVIEW_NOTE in note:
        return note
    if note:
        return note + "; " + REVIEW_NOTE
    return REVIEW_NOTE


def apply_corrections(csv_path, corrections):
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    if "label_confidence" not in fieldnames:
        fieldnames.append("label_confidence")
    if "note" not in fieldnames:
        fieldnames.append("note")

    updated = []
    for index, row in enumerate(rows, start=2):
        correction = corrections.get(index)
        if not correction:
            continue

        old_label = row.get("label", "")
        row["label"] = correction["new_label"]
        row["label_confidence"] = correction["label_confidence"]
        row["note"] = append_note(row.get("note", ""))
        updated.append((index, old_label, row["label"]))

    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return updated


def main():
    parser = argparse.ArgumentParser(description="Apply low-confidence review label corrections to labels.csv.")
    parser.add_argument("--csv", default="training_data/labels.csv")
    parser.add_argument("--corrections", required=True)
    args = parser.parse_args()

    csv_path = Path(args.csv)
    corrections_path = Path(args.corrections)
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")
    if not corrections_path.exists():
        raise SystemExit(f"Corrections file not found: {corrections_path}")

    corrections = load_corrections(corrections_path)
    updated = apply_corrections(csv_path, corrections)

    print("Corrections requested:", len(corrections))
    print("Rows updated:", len(updated))
    for line_number, old_label, new_label in updated:
        print(f"line {line_number}: {old_label} -> {new_label}")


if __name__ == "__main__":
    main()

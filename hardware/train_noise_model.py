import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


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


def load_dataset(csv_path):
    rows = []
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            label = row.get("label", "").strip()
            if not label:
                continue
            try:
                features = [float(row[column]) for column in FEATURE_COLUMNS]
            except (KeyError, TypeError, ValueError):
                continue
            rows.append({"label": label, "features": features})

    if not rows:
        raise ValueError("No valid training rows found")

    x = np.asarray([row["features"] for row in rows], dtype=np.float64)
    y = np.asarray([row["label"] for row in rows])
    return x, y


def build_model(seed):
    return Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=300,
                    max_depth=None,
                    min_samples_leaf=2,
                    class_weight="balanced",
                    random_state=seed,
                ),
            ),
        ]
    )


def save_metadata(path, labels, label_counts, train_accuracy, test_accuracy, report):
    metadata = {
        "model_type": "sklearn_random_forest_fft_features_v1",
        "feature_columns": FEATURE_COLUMNS,
        "labels": labels,
        "label_counts": dict(label_counts),
        "train_accuracy": round(float(train_accuracy), 4),
        "test_accuracy": round(float(test_accuracy), 4),
        "classification_report": report,
    }
    with path.open("w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2, sort_keys=True)


def main():
    parser = argparse.ArgumentParser(description="Train a noise type classifier from FFT feature labels.")
    parser.add_argument("--csv", default="training_data/labels.csv")
    parser.add_argument("--output", default="training_data/noise_model.joblib")
    parser.add_argument("--metadata", default="training_data/noise_model_metadata.json")
    parser.add_argument("--test-ratio", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise SystemExit(f"Training CSV not found: {csv_path}")

    x, y = load_dataset(csv_path)
    label_counts = Counter(y)
    if len(label_counts) < 2:
        raise SystemExit("Need at least two labels to train a classifier")

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=args.test_ratio,
        random_state=args.seed,
        stratify=y,
    )

    model = build_model(args.seed)
    model.fit(x_train, y_train)

    train_predictions = model.predict(x_train)
    test_predictions = model.predict(x_test)
    train_accuracy = accuracy_score(y_train, train_predictions)
    test_accuracy = accuracy_score(y_test, test_predictions)
    labels = sorted(label_counts.keys())
    report = classification_report(y_test, test_predictions, labels=labels, zero_division=0, output_dict=True)
    matrix = confusion_matrix(y_test, test_predictions, labels=labels)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "feature_columns": FEATURE_COLUMNS,
            "labels": labels,
        },
        output_path,
    )
    save_metadata(Path(args.metadata), labels, label_counts, train_accuracy, test_accuracy, report)

    print("Rows:", len(y))
    print("Label counts:", dict(label_counts))
    print("Train accuracy:", round(float(train_accuracy), 4))
    print("Test accuracy:", round(float(test_accuracy), 4))
    print("Saved model:", output_path)
    print("Saved metadata:", args.metadata)
    print("\nConfusion matrix")
    print("actual\\predicted," + ",".join(labels))
    for label, values in zip(labels, matrix):
        print(label + "," + ",".join(str(int(value)) for value in values))
    print("\nClassification report")
    print(classification_report(y_test, test_predictions, labels=labels, zero_division=0))


if __name__ == "__main__":
    main()

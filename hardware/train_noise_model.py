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

NOISE_GROUP_BY_LABEL = {
    "human_voice": "human_created_noise",
    "music": "human_created_noise",
    "impact_noise": "human_created_noise",
    "environment_noise": "environment_noise",
    "background": "background",
}
DEPLOYED_NOISE_GROUPS = [
    "background",
    "environment_noise",
    "human_created_noise",
]
DEFAULT_LABEL_WEIGHT_MULTIPLIERS = {
    "environment_noise": 6.0,
}


def load_dataset(csv_path, label_weight_multipliers=None):
    label_weight_multipliers = label_weight_multipliers or {}
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
            try:
                label_confidence = float(row.get("label_confidence") or 1.0)
            except (TypeError, ValueError):
                label_confidence = 1.0
            label_weight = label_weight_multipliers.get(label, 1.0)
            rows.append(
                {
                    "label": label,
                    "features": features,
                    "label_confidence": max(label_confidence * label_weight, 0.01),
                }
            )

    if not rows:
        raise ValueError("No valid training rows found")

    x = np.asarray([row["features"] for row in rows], dtype=np.float64)
    y = np.asarray([row["label"] for row in rows])
    sample_weight = np.asarray([row["label_confidence"] for row in rows], dtype=np.float64)
    return x, y, sample_weight


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


def grouped_accuracy(y_true, y_pred):
    grouped_true = [NOISE_GROUP_BY_LABEL.get(label, label) for label in y_true]
    grouped_pred = [NOISE_GROUP_BY_LABEL.get(label, label) for label in y_pred]
    return accuracy_score(grouped_true, grouped_pred)


def parse_label_weight(value):
    if "=" not in value:
        raise argparse.ArgumentTypeError("Expected LABEL=WEIGHT, for example environment_noise=4")
    label, weight = value.split("=", 1)
    label = label.strip()
    if not label:
        raise argparse.ArgumentTypeError("Label cannot be empty")
    try:
        parsed_weight = float(weight)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid weight for {label}: {weight}") from exc
    if parsed_weight <= 0:
        raise argparse.ArgumentTypeError("Weight must be greater than zero")
    return label, parsed_weight


def save_metadata(path, labels, label_counts, label_weight_multipliers, train_accuracy, test_accuracy, grouped_test_accuracy, report):
    metadata = {
        "model_type": "sklearn_random_forest_fft_features_v1",
        "deployment_mode": "grouped_noise_type_v1",
        "feature_columns": FEATURE_COLUMNS,
        "labels": labels,
        "deployed_labels": DEPLOYED_NOISE_GROUPS,
        "noise_group_by_label": NOISE_GROUP_BY_LABEL,
        "label_weight_multipliers": label_weight_multipliers,
        "label_counts": dict(label_counts),
        "train_accuracy": round(float(train_accuracy), 4),
        "test_accuracy": round(float(test_accuracy), 4),
        "grouped_test_accuracy": round(float(grouped_test_accuracy), 4),
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
    parser.add_argument(
        "--label-weight",
        action="append",
        type=parse_label_weight,
        default=[],
        help="Extra class weight multiplier, for example --label-weight environment_noise=6",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise SystemExit(f"Training CSV not found: {csv_path}")

    label_weight_multipliers = dict(DEFAULT_LABEL_WEIGHT_MULTIPLIERS)
    label_weight_multipliers.update(dict(args.label_weight))

    x, y, sample_weight = load_dataset(csv_path, label_weight_multipliers)
    label_counts = Counter(y)
    if len(label_counts) < 2:
        raise SystemExit("Need at least two labels to train a classifier")

    x_train, x_test, y_train, y_test, weight_train, _weight_test = train_test_split(
        x,
        y,
        sample_weight,
        test_size=args.test_ratio,
        random_state=args.seed,
        stratify=y,
    )

    model = build_model(args.seed)
    model.fit(x_train, y_train, classifier__sample_weight=weight_train)

    train_predictions = model.predict(x_train)
    test_predictions = model.predict(x_test)
    train_accuracy = accuracy_score(y_train, train_predictions)
    test_accuracy = accuracy_score(y_test, test_predictions)
    grouped_test = grouped_accuracy(y_test, test_predictions)
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
    save_metadata(Path(args.metadata), labels, label_counts, label_weight_multipliers, train_accuracy, test_accuracy, grouped_test, report)

    print("Rows:", len(y))
    print("Label counts:", dict(label_counts))
    print("Label weight multipliers:", label_weight_multipliers)
    print("Train accuracy:", round(float(train_accuracy), 4))
    print("Test accuracy:", round(float(test_accuracy), 4))
    print("Grouped test accuracy:", round(float(grouped_test), 4))
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

"""Python parsing and control-flow fixture."""


def normalize_report(value):
    """Normalize a report value through two visible branches."""
    if value is None:
        return "missing"
    return value.strip().lower()


def main():
    """Python entry point fixture."""
    return normalize_report(" DEMO ")


if __name__ == "__main__":
    main()

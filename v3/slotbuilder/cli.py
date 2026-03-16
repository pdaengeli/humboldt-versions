#!/usr/bin/env python3
import sys
import json
import argparse
import xml.etree.ElementTree as ET
from .slot import build_slots

def main():
    parser = argparse.ArgumentParser(description="Convert TEI VM XML to slot JSON.")
    parser.add_argument("xml_path", help="Path to TEI VM XML file")
    parser.add_argument("--out", "-o", help="Output file (default: stdout)")
    parser.add_argument("--indent", type=int, default=2, help="JSON indent (default: 2)")
    args = parser.parse_args()

    tree = ET.parse(args.xml_path)
    root = tree.getroot()
    slot_json = build_slots(root)

    dest = open(args.out, "w", encoding="utf-8") if args.out else sys.stdout
    json.dump(slot_json, dest, ensure_ascii=False, indent=args.indent)
    if dest is not sys.stdout:
        dest.write("\n")
        dest.close()

if __name__ == "__main__":
    main()
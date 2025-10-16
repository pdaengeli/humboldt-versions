# *Ansichten der Natur* – Text Comparison Tool

Prototype tool for visualizing textual changes across three editions of Humboldt's Ansichten der Natur (1808, 1826, 1849).

## Quick Start

### Required Files

```
/
├── compare_with_notes_aligned.py
├── viewer_provenance_full.html
├── *1808*.xml  (TEI-XML)
├── *1826*.xml  (TEI-XML)
└── *1849*.xml  (TEI-XML)
```

The script automatically finds XML files by year in the filename.

There is a pipeline to prepare the files in the `data-preparation` directory (invoke the script with e.g. `java -jar /opt/Saxonica/SaxonHE12-9/saxon-he-12.9.jar -xsl:data-preparation/processing/run.xsl -s:data-preparation/processing/run.xsl -it`).

### Installation

`pip install lxml`

### Usage

1. Run analysis:

    ```
    python compare_with_notes_aligned.py
    ```

This generates comparison_provenance.json (takes approximately 30 seconds for 350 paragraphs).

2. View results:

    ```
    python -m http.server 8000
    ```

Then open: http://localhost:8000/viewer_provenance_full.html

### What It Does

- Aligns paragraphs across editions using Jaccard similarity (50 percent threshold)
- Compares text word-by-word to identify changes
- Classifies variants: orthographic, lexical, substitution, addition, deletion
- Tracks notes across editions with position information
- Color codes text layers: 1808 (blue), 1826 (red), 1849 (black)

### Output

The JSON file contains:
- Unified text with word-level provenance
- Similarity scores between editions
- Change statistics (added and removed words)
- Aligned notes with full textual apparatus
- Note positions mapped to token indices

## Current Limitations

- Basic greedy alignment (no reordering detection)
- Token-based only (whitespace splitting)
- No images or tables support
- Desktop-optimized UI
- No export functions yet

## Ideas for Improvement

- Adapt for CollateX-based alignment
- Export to TEI (maybe PDF, CSV), ideally in one file with apparatus entries

- Interface
  - Interactive highlighting when hovering change statistics
- Search functionality
- Performance optimization for larger texts

- Nice to have
  - Manual alignment correction interface
  - Annotation capabilities
  - Multiple document support

- Possibilities (at some point)
  - Named entity recognition
  - Sentence structure analysis

## Technical Notes

* Alignment algorithm: Greedy best-match based on token overlap
* Similarity metric: Jaccard coefficient (intersection over union of word sets)
* Variant classification: Levenshtein distance for orthographic changes
* Browser requirements: Modern browser with ES6 support

## Status

Prototype - Functional for analysis and visualization, primarily meant for discussion (data model and UI may change).


```
Created: September 2025
Last updated: 2025-10-13
```

# Refactoring goals

## Background and overall goal:

Alexander von Humboldt published "Ansichten der Natur" in three versions: 1809, 1826, and 1849. He 
primarily added new parts between these versions, especially in the footnotes. These additions 
reflect scientific progress and it is interesting to analyse the extent and character of these 
extensions. Stylistic adaptations are less common and removal of information is rare.

We aim to create an elegant presentation that allows to read the text and to understand what was 
added when and what differences there are. Prototyping led us to a very promising idea that we would 
now like to implement. The goal is to condense the three versions or the two stage-process into a 
light-weight text rendering that offers more information on closer inspection (e.g. interactive 
features).

The text consists of a number of chapters that are a sequence of paragraphs, followed by footnotes. 
These notes can themselves be considerably long and contain annotations themselves (essentially 
nested footnotes).

### Idea resulting from the prototyping stage

Each paragraph should be rendered as a separate unit having a para number (that allows direct 
referencing), offering some statistics (what proportion of the text was added in which version, how 
much growth in stage one and stage two). Akin to the layout of a book, a paragraph will have a header 
line that indicates from which version the bulk of the paragraph originates. For paragraphs available 
in 1809 this would be "1809", for paragraphs added in the last version it would be "1849".

For each paragraph, all text that is part of the (respective) earliest version is printed in black. 
All modifications within the paragraph are indicated either inline (character-level) or in the margin 
(longer changes or changes that need more explanation). All modifications are highlighted in colour 
(one colour for 1826, one for 1849). It is important to note that the differences should be recorded 
on the smallest possible level. For instance, this word that saw two edits over time

```xml
Ueberblick der Natur im <app>
    <rdg wit="#1808">Grossen</rdg>
    <rdg wit="#1826">Großen</rdg>
    <rdg wit="#1849">großen</rdg>
</app>, Beweis von dem Zusammenwirken der Kräfte, Erneuerung des Genusses, 
```
 should be presented as 
```html 
<div class="chapterhead"><span>1808</span>span></div> # sort of running paragraph head 
indicating the base year of the paragraph … 
<span style="color: black;">Ueberblick der Natur im <span style="color: red;">G</span>ro<span style="color:orange">ss</span>en,</span> … 
```

This will convey to readers that all text was present in 1808, but the "G" was modified in 1849 (red) 
and "ss" in 1826 (orange). What was actually modified is not made explicit (in the web version it 
could be indicated in a tooltip or similar, but in print it will be left to the readers 
interpretation, aided by an introduction that explains common modifications).

It is obvious that the current enocding/output of the alignment tool does not lend itself well to 
this kind of rendering. Instead the generation of the slot format should establish all information 
needed and record it on character level. Equally, specific colouring should not be part of the data 
format but remain flexible for adjustments.

Ideally, the generation of the slot format is configurable in a way that for instance allows to 
specify "ss" to "ß" as an inline variant but "i" to "ü" as a marginal variant (by defining an inline 
set and treating the rest as marginal).

## Current implementation:

The current web site is based on the output of a collation tool that aligns variants and gives them 
back in a simple format (versioning-machine-compatible TEI XML; strings common to all three variants 
are given once, and variants are given in parallel for all three versions, even if that entails some 
redundancy). This XML is converted to a slot format using a python script. The web site loads a 
number of paragraphs and renders them with their differences. On scroll or on TOC interaction more is 
loaded and rendered. Paragraphs are addressable and enriched with some statistics on their variance.

Complication: the tool used for collation/alignment is powerful and gives good output. However 
formatting information contained in the input is lost in the output. We should look for a way to 
stand-off annotate the strings with formatting information, i.e. to record the index position in the 
input format and then recalculate it in the output.

### Shortcomings of the current implementation:

- Variants are not established on character-level and there is no distinction between inline and 
margin variants. 
- All logic and UI contained in index.html. 
- Formatting information is lost in the collation step and not re-introduced.

## Desired refactor:

- Processing of versioning-machine TEI XML into a slot format suitable for the generation of the 
frontend renderings but also a (pre) print format.
- Clear separation of inline and margin variants.
- The presentation of variants should be as reduced as possible and the resulting reading should 
exactly correspond to the earliest version of the text. Additional information can be given on 
interaction (e.g. which character(s) substituted by what other(s) in which subsequent version).
- Each paragraph shall be retrievable (by TOC and direct URL request). 
- Overall organisation and styling of the page should be retained. 
- Clean frontend architecture that facilitates later updates to logic and styling. Perhaps separate 
modules: data layer (Python), JSON or SQLite storage, presentation layer (HTML/JS/CSS).
- For performance reasons not the whole text or entire chapters should be loaded at once. Instead 
only a subset should be extracted from the JSON or the data could be stored in an SQLite or similar 
database and fetched from there.

## Later enhancements:

- Re-introduce formatting/typographic information based on character index.
- Search (either clientside using e.g. MiniSearch or serverside using Solr)

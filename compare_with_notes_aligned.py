from lxml import etree
import json
from pathlib import Path
import difflib
import re

class FinalAnalyzerWithAlignedNotes:
    def __init__(self):
        self.editions = {}
        self.edition_trees = {}
    
    def load_tei(self, filepath, year):
        print(f"Loading {year}...")
        try:
            parser = etree.XMLParser(recover=True, resolve_entities=False)
            tree = etree.parse(filepath, parser)
            self.edition_trees[year] = tree
        except Exception as e:
            print(f"  Error: {e}")
            return []
        
        paragraphs = []
        for p in tree.xpath('//body//p'):
            text = ' '.join(p.itertext()).strip()
            if text and len(text) > 20:
                paragraphs.append({
                    'text': text,
                    'element': p
                })
        
        if not paragraphs:
            for p in tree.xpath('//div//p'):
                text = ' '.join(p.itertext()).strip()
                if text and len(text) > 20:
                    paragraphs.append({
                        'text': text,
                        'element': p
                    })
        
        print(f"  Found {len(paragraphs)} paragraphs")
        self.editions[year] = paragraphs
        return paragraphs
    
    def extract_note_positions_from_paragraph(self, para_element, year):
        """Extract notes and their positions in the paragraph text"""
        if para_element is None:
            return []
        
        root = self.edition_trees[year].getroot()
        notes_with_positions = []
        
        text_parts = []
        note_markers = []
        
        def extract_text_with_markers(elem, current_pos=0):
            if elem.text:
                text_parts.append(elem.text)
                current_pos += len(elem.text)
            
            for child in elem:
                if child.tag.endswith('note') and child.get('place') == 'end' and not child.text and len(child) == 0:
                    n = child.get('n', '').strip()
                    if n:
                        note_markers.append({
                            'position': current_pos,
                            'n': n
                        })
                
                current_pos = extract_text_with_markers(child, current_pos)
                
                if child.tail:
                    text_parts.append(child.tail)
                    current_pos += len(child.tail)
            
            return current_pos
        
        extract_text_with_markers(para_element)
        full_text = ''.join(text_parts)
        
        for marker in note_markers:
            n = marker['n']
            xpath = f'.//note[@place="end" and @n="{n}" and node()]'
            note_content_list = root.xpath(xpath)
            
            if note_content_list:
                note_elem = note_content_list[0]
                plain_text = ' '.join(note_elem.itertext()).strip()
                content_parts = []
                for child in note_elem:
                    content_parts.append(etree.tostring(child, encoding='unicode', method='html'))
                
                notes_with_positions.append({
                    'n': n,
                    'position': marker['position'],
                    'content_html': ''.join(content_parts),
                    'plain_text': plain_text,
                    'year': year
                })
        
        return notes_with_positions
    
    def tokenize(self, text):
        """Tokenize preserving punctuation"""
        return re.findall(r'\S+', text)
    
    def similarity_ratio(self, text1, text2):
        """Calculate similarity between two texts"""
        tokens1 = set(self.tokenize(text1.lower()))
        tokens2 = set(self.tokenize(text2.lower()))
        
        if not tokens1 or not tokens2:
            return 0.0
        
        intersection = tokens1.intersection(tokens2)
        union = tokens1.union(tokens2)
        
        return len(intersection) / len(union) if union else 0.0
    
    def levenshtein_distance(self, s1, s2):
        """Calculate edit distance between two strings"""
        if len(s1) < len(s2):
            return self.levenshtein_distance(s2, s1)
        if len(s2) == 0:
            return len(s1)
        
        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row
        
        return previous_row[-1]
    
    def classify_variant(self, text1, text2, change_type):
        """Classify variant into categories"""
        if change_type == 'insert':
            return 'addition'
        elif change_type == 'delete':
            return 'deletion'
        elif change_type == 'replace':
            if not text1 or not text2:
                return 'substitution'
            
            words1 = text1.split()
            words2 = text2.split()
            
            if len(words1) == 1 and len(words2) == 1:
                dist = self.levenshtein_distance(text1.lower(), text2.lower())
                max_len = max(len(text1), len(text2))
                
                if dist <= 2 or (max_len > 0 and dist / max_len < 0.3):
                    return 'orthographic'
                else:
                    return 'lexical'
            elif len(words1) <= 3 and len(words2) <= 3:
                return 'lexical'
            else:
                return 'substitution'
        
        return 'other'
    
    def align_notes(self, notes_1808, notes_1826, notes_1849):
        """Align notes across editions based on similarity"""
        alignments = []
        used_1826 = set()
        used_1849 = set()
        
        for note_1808 in notes_1808:
            alignment = {
                '1808': note_1808,
                '1826': None,
                '1849': None,
                'scores': {}
            }
            
            if notes_1826:
                best_match = None
                best_score = 0.3
                
                for idx, note_1826 in enumerate(notes_1826):
                    if idx in used_1826:
                        continue
                    score = self.similarity_ratio(note_1808['plain_text'], note_1826['plain_text'])
                    if score > best_score:
                        best_score = score
                        best_match = (idx, note_1826)
                
                if best_match:
                    idx, note = best_match
                    alignment['1826'] = note
                    alignment['scores']['1826'] = best_score
                    used_1826.add(idx)
            
            if notes_1849:
                best_match = None
                best_score = 0.3
                
                for idx, note_1849 in enumerate(notes_1849):
                    if idx in used_1849:
                        continue
                    score = self.similarity_ratio(note_1808['plain_text'], note_1849['plain_text'])
                    if score > best_score:
                        best_score = score
                        best_match = (idx, note_1849)
                
                if best_match:
                    idx, note = best_match
                    alignment['1849'] = note
                    alignment['scores']['1849'] = best_score
                    used_1849.add(idx)
            
            alignments.append(alignment)
        
        for idx, note_1826 in enumerate(notes_1826):
            if idx not in used_1826:
                alignment = {
                    '1808': None,
                    '1826': note_1826,
                    '1849': None,
                    'scores': {},
                    'new_in_1826': True
                }
                
                if notes_1849:
                    best_match = None
                    best_score = 0.3
                    
                    for idx49, note_1849 in enumerate(notes_1849):
                        if idx49 in used_1849:
                            continue
                        score = self.similarity_ratio(note_1826['plain_text'], note_1849['plain_text'])
                        if score > best_score:
                            best_score = score
                            best_match = (idx49, note_1849)
                    
                    if best_match:
                        idx49, note = best_match
                        alignment['1849'] = note
                        alignment['scores']['1849'] = best_score
                        used_1849.add(idx49)
                
                alignments.append(alignment)
        
        for idx, note_1849 in enumerate(notes_1849):
            if idx not in used_1849:
                alignments.append({
                    '1808': None,
                    '1826': None,
                    '1849': note_1849,
                    'scores': {},
                    'new_in_1849': True
                })
        
        return alignments
    
    def build_note_unified_text(self, note_1808, note_1826, note_1849):
        """Build unified text for notes with similarity scores"""
        # Calculate similarity scores between editions
        scores = {}
        
        if note_1808 and note_1826:
            scores['1826'] = self.similarity_ratio(note_1808['plain_text'], note_1826['plain_text'])
        
        if note_1808 and note_1849:
            scores['1849'] = self.similarity_ratio(note_1808['plain_text'], note_1849['plain_text'])
        elif note_1826 and note_1849:
            # If no 1808 version, compare 1826 to 1849
            scores['1849'] = self.similarity_ratio(note_1826['plain_text'], note_1849['plain_text'])
        
        # New in 1849
        if not note_1808 and not note_1826 and note_1849:
            tokens = self.tokenize(note_1849['plain_text'])
            return {
                'unified_text': [{
                    'text': token,
                    'color': 'black',
                    'editions': ['1849'],
                    'type': 'new_in_1849',
                    'category': 'addition'
                } for token in tokens],
                'n': note_1849['n'],
                'editions': ['1849'],
                'scores': {},
                'originals': {
                    '1808': None,
                    '1826': None,
                    '1849': note_1849['plain_text']
                }
            }
        
        # New in 1826
        if not note_1808 and note_1826:
            tokens = self.tokenize(note_1826['plain_text'])
            unified = [{
                'text': token,
                'color': 'red',
                'editions': ['1826'],
                'type': 'new_in_1826',
                'category': 'addition'
            } for token in tokens]
            
            if note_1849:
                text_1826 = note_1826['plain_text']
                text_1849 = note_1849['plain_text']
                tokens_1826 = self.tokenize(text_1826)
                tokens_1849 = self.tokenize(text_1849)
                
                unified = self.apply_note_changes(unified, tokens_1826, tokens_1849, '1849')
                editions = ['1826', '1849']
            else:
                editions = ['1826']
            
            return {
                'unified_text': unified,
                'n': note_1826['n'],
                'editions': editions,
                'scores': scores,
                'originals': {
                    '1808': None,
                    '1826': note_1826['plain_text'],
                    '1849': note_1849['plain_text'] if note_1849 else None
                }
            }
        
        # Exists in 1808
        if not note_1849:
            tokens = self.tokenize(note_1808['plain_text']) if note_1808 else []
            return {
                'unified_text': [{
                    'text': token,
                    'color': 'blue',
                    'editions': ['1808'],
                    'type': 'original',
                    'category': None
                } for token in tokens],
                'n': note_1808['n'] if note_1808 else '',
                'editions': ['1808'],
                'scores': {},
                'originals': {
                    '1808': note_1808['plain_text'] if note_1808 else None,
                    '1826': None,
                    '1849': None
                }
            }
        
        # Compare across editions
        text_1808 = note_1808['plain_text'] if note_1808 else ''
        text_1826 = note_1826['plain_text'] if note_1826 else ''
        text_1849 = note_1849['plain_text'] if note_1849 else ''
        
        tokens_1808 = self.tokenize(text_1808) if text_1808 else []
        tokens_1826 = self.tokenize(text_1826) if text_1826 else []
        tokens_1849 = self.tokenize(text_1849) if text_1849 else []
        
        segments = []
        
        if tokens_1808 and tokens_1826:
            matcher = difflib.SequenceMatcher(None, tokens_1808, tokens_1826)
            
            for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                if tag == 'equal':
                    for i in range(i1, i2):
                        segments.append({
                            'text': tokens_1808[i],
                            'color': 'blue',
                            'editions': ['1808', '1826'],
                            'type': 'original',
                            'category': None
                        })
                
                elif tag == 'replace':
                    old_text = ' '.join(tokens_1808[i1:i2])
                    new_text = ' '.join(tokens_1826[j1:j2])
                    category = self.classify_variant(old_text, new_text, 'replace')
                    
                    segments.append({
                        'text': old_text,
                        'color': 'blue',
                        'editions': ['1808'],
                        'type': 'replaced',
                        'replaced_by': new_text,
                        'category': category
                    })
                    
                    segments.append({
                        'text': new_text,
                        'color': 'red',
                        'editions': ['1826'],
                        'type': 'replacement',
                        'category': category
                    })
                
                elif tag == 'delete':
                    for i in range(i1, i2):
                        segments.append({
                            'text': tokens_1808[i],
                            'color': 'blue',
                            'editions': ['1808'],
                            'type': 'deleted_1826',
                            'category': 'deletion'
                        })
                
                elif tag == 'insert':
                    for j in range(j1, j2):
                        segments.append({
                            'text': tokens_1826[j],
                            'color': 'red',
                            'editions': ['1826'],
                            'type': 'added_1826',
                            'category': 'addition'
                        })
        elif tokens_1808:
            for token in tokens_1808:
                segments.append({
                    'text': token,
                    'color': 'blue',
                    'editions': ['1808'],
                    'type': 'original',
                    'category': None
                })
        
        if tokens_1849 and (tokens_1826 or tokens_1808):
            base_tokens = tokens_1826 if tokens_1826 else tokens_1808
            segments = self.apply_note_changes(segments, base_tokens, tokens_1849, '1849')
        
        editions = []
        if note_1808:
            editions.append('1808')
        if note_1826:
            editions.append('1826')
        if note_1849:
            editions.append('1849')
        
        return {
            'unified_text': segments,
            'n': note_1849['n'] if note_1849 else (note_1826['n'] if note_1826 else note_1808['n']),
            'editions': editions,
            'scores': scores,
            'originals': {
                '1808': text_1808 if text_1808 else None,
                '1826': text_1826 if text_1826 else None,
                '1849': text_1849 if text_1849 else None
            }
        }
    
    def apply_note_changes(self, segments, tokens_base, tokens_new, year):
        """Apply changes for a new year to note segments"""
        matcher = difflib.SequenceMatcher(None, tokens_base, tokens_new)
        
        new_segments = []
        seg_idx = 0
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'equal':
                for i in range(i1, i2):
                    if seg_idx < len(segments):
                        seg = segments[seg_idx].copy()
                        if year not in seg['editions']:
                            seg['editions'].append(year)
                        new_segments.append(seg)
                        seg_idx += 1
            
            elif tag == 'replace':
                old_text = ' '.join(tokens_base[i1:i2])
                new_text = ' '.join(tokens_new[j1:j2])
                category = self.classify_variant(old_text, new_text, 'replace')
                
                if seg_idx < len(segments):
                    seg = segments[seg_idx].copy()
                    seg['type'] = 'replaced'
                    seg['replaced_by'] = new_text
                    seg['category'] = category
                    new_segments.append(seg)
                    seg_idx += (i2 - i1)
                
                color = 'black' if year == '1849' else 'red'
                new_segments.append({
                    'text': new_text,
                    'color': color,
                    'editions': [year],
                    'type': f'added_{year}',
                    'category': category
                })
            
            elif tag == 'delete':
                for i in range(i1, i2):
                    if seg_idx < len(segments):
                        seg = segments[seg_idx].copy()
                        seg['type'] = f'deleted_{year}'
                        seg['category'] = 'deletion'
                        new_segments.append(seg)
                        seg_idx += 1
            
            elif tag == 'insert':
                color = 'black' if year == '1849' else 'red'
                for j in range(j1, j2):
                    new_segments.append({
                        'text': tokens_new[j],
                        'color': color,
                        'editions': [year],
                        'type': f'added_{year}',
                        'category': 'addition'
                    })
        
        return new_segments
    
    def find_best_match(self, para_text, candidate_paragraphs, threshold=0.5):
        """Find the best matching paragraph from candidates"""
        best_match = None
        best_score = threshold
        best_idx = -1
        
        for idx, candidate in enumerate(candidate_paragraphs):
            score = self.similarity_ratio(para_text, candidate['text'])
            if score > best_score:
                best_score = score
                best_match = candidate
                best_idx = idx
        
        return best_match, best_idx, best_score
    
    def align_paragraphs(self):
        """Align paragraphs across editions based on content similarity"""
        paras_1808 = self.editions.get('1808', [])
        paras_1826 = self.editions.get('1826', [])
        paras_1849 = self.editions.get('1849', [])
        
        alignments = []
        used_1826 = set()
        used_1849 = set()
        
        print(f"\nAligning paragraphs by similarity (threshold: 50%)...")
        
        for i, para_1808 in enumerate(paras_1808):
            if i % 10 == 0:
                print(f"  Processing paragraph {i+1}/{len(paras_1808)}...")
            
            alignment = {
                'index': i,
                '1808': para_1808['text'],
                '1808_element': para_1808.get('element'),
                '1826': None,
                '1826_element': None,
                '1849': None,
                '1849_element': None,
                'scores': {}
            }
            
            if paras_1826:
                available_1826 = [p for idx, p in enumerate(paras_1826) if idx not in used_1826]
                match_1826, idx_1826, score_1826 = self.find_best_match(
                    para_1808['text'], 
                    available_1826,
                    threshold=0.5
                )
                
                if match_1826:
                    orig_idx = paras_1826.index(match_1826)
                    alignment['1826'] = match_1826['text']
                    alignment['1826_element'] = match_1826.get('element')
                    alignment['scores']['1826'] = score_1826
                    used_1826.add(orig_idx)
            
            if paras_1849:
                available_1849 = [p for idx, p in enumerate(paras_1849) if idx not in used_1849]
                match_1849, idx_1849, score_1849 = self.find_best_match(
                    para_1808['text'],
                    available_1849,
                    threshold=0.5
                )
                
                if match_1849:
                    orig_idx = paras_1849.index(match_1849)
                    alignment['1849'] = match_1849['text']
                    alignment['1849_element'] = match_1849.get('element')
                    alignment['scores']['1849'] = score_1849
                    used_1849.add(orig_idx)
            
            alignments.append(alignment)
        
        print(f"  Checking for new 1849 material...")
        for idx, para_1849 in enumerate(paras_1849):
            if idx not in used_1849:
                alignments.append({
                    'index': len(alignments),
                    '1808': None,
                    '1808_element': None,
                    '1826': None,
                    '1826_element': None,
                    '1849': para_1849['text'],
                    '1849_element': para_1849.get('element'),
                    'scores': {},
                    'new_in_1849': True
                })
        
        print(f"  Total alignments: {len(alignments)}")
        return alignments
    
    def build_unified_text(self, para_1808, para_1826, para_1849):
        """Build unified text with provenance tracking AND classification"""
        if not para_1808 and not para_1826 and para_1849:
            tokens = self.tokenize(para_1849)
            return [{
                'text': token,
                'color': 'black',
                'editions': ['1849'],
                'type': 'new_in_1849',
                'category': 'addition'
            } for token in tokens]
        
        if not para_1849:
            tokens = self.tokenize(para_1808) if para_1808 else []
            return [{
                'text': token,
                'color': 'blue',
                'editions': ['1808'],
                'type': 'original',
                'category': None
            } for token in tokens]
        
        tokens_1808 = self.tokenize(para_1808) if para_1808 else []
        tokens_1826 = self.tokenize(para_1826) if para_1826 else []
        tokens_1849 = self.tokenize(para_1849) if para_1849 else []
        
        segments = []
        
        if tokens_1808 and tokens_1826:
            matcher = difflib.SequenceMatcher(None, tokens_1808, tokens_1826)
            
            for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                if tag == 'equal':
                    for i in range(i1, i2):
                        segments.append({
                            'text': tokens_1808[i],
                            'color': 'blue',
                            'editions': ['1808', '1826'],
                            'type': 'original',
                            'category': None
                        })
                
                elif tag == 'replace':
                    old_text = ' '.join(tokens_1808[i1:i2])
                    new_text = ' '.join(tokens_1826[j1:j2])
                    category = self.classify_variant(old_text, new_text, 'replace')
                    
                    segments.append({
                        'text': old_text,
                        'color': 'blue',
                        'editions': ['1808'],
                        'type': 'replaced',
                        'replaced_by': new_text,
                        'category': category
                    })
                    
                    segments.append({
                        'text': new_text,
                        'color': 'red',
                        'editions': ['1826'],
                        'type': 'replacement',
                        'category': category
                    })
                
                elif tag == 'delete':
                    for i in range(i1, i2):
                        segments.append({
                            'text': tokens_1808[i],
                            'color': 'blue',
                            'editions': ['1808'],
                            'type': 'deleted_1826',
                            'category': 'deletion'
                        })
                
                elif tag == 'insert':
                    for j in range(j1, j2):
                        segments.append({
                            'text': tokens_1826[j],
                            'color': 'red',
                            'editions': ['1826'],
                            'type': 'added_1826',
                            'category': 'addition'
                        })
        elif tokens_1808:
            for token in tokens_1808:
                segments.append({
                    'text': token,
                    'color': 'blue',
                    'editions': ['1808'],
                    'type': 'original',
                    'category': None
                })
        
        if tokens_1849 and (tokens_1826 or tokens_1808):
            base_tokens = tokens_1826 if tokens_1826 else tokens_1808
            segments = self.apply_1849_changes(segments, base_tokens, tokens_1849)
        
        return segments
    
    def apply_1849_changes(self, segments, tokens_base, tokens_1849):
        """Apply 1849 changes with classification"""
        matcher = difflib.SequenceMatcher(None, tokens_base, tokens_1849)
        
        new_segments = []
        seg_idx = 0
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'equal':
                for i in range(i1, i2):
                    if seg_idx < len(segments):
                        seg = segments[seg_idx].copy()
                        if '1849' not in seg['editions']:
                            seg['editions'].append('1849')
                        new_segments.append(seg)
                        seg_idx += 1
            
            elif tag == 'replace':
                old_text = ' '.join(tokens_base[i1:i2])
                new_text = ' '.join(tokens_1849[j1:j2])
                category = self.classify_variant(old_text, new_text, 'replace')
                
                if seg_idx < len(segments):
                    seg = segments[seg_idx].copy()
                    seg['type'] = 'replaced'
                    seg['replaced_by'] = new_text
                    seg['category'] = category
                    new_segments.append(seg)
                    seg_idx += (i2 - i1)
                
                new_segments.append({
                    'text': new_text,
                    'color': 'black',
                    'editions': ['1849'],
                    'type': 'added_1849',
                    'category': category
                })
            
            elif tag == 'delete':
                for i in range(i1, i2):
                    if seg_idx < len(segments):
                        seg = segments[seg_idx].copy()
                        seg['type'] = 'deleted_1849'
                        seg['category'] = 'deletion'
                        new_segments.append(seg)
                        seg_idx += 1
            
            elif tag == 'insert':
                for j in range(j1, j2):
                    new_segments.append({
                        'text': tokens_1849[j],
                        'color': 'black',
                        'editions': ['1849'],
                        'type': 'added_1849',
                        'category': 'addition'
                    })
        
        return new_segments
    
    def map_note_positions_to_tokens(self, text, note_positions):
        """Map character positions to token positions"""
        tokens = self.tokenize(text)
        token_positions = []
        
        current_pos = 0
        for token in tokens:
            token_start = text.find(token, current_pos)
            if token_start == -1:
                token_start = current_pos
            token_end = token_start + len(token)
            token_positions.append((token_start, token_end, token))
            current_pos = token_end
        
        note_to_token_map = {}
        for note in note_positions:
            note_pos = note['position']
            best_token_idx = 0
            for idx, (start, end, token) in enumerate(token_positions):
                if note_pos >= start:
                    best_token_idx = idx
                else:
                    break
            note_to_token_map[note['n']] = best_token_idx
        
        return note_to_token_map
    
    def analyze(self):
        alignments = self.align_paragraphs()
        results = []
        
        print(f"\nBuilding unified texts with aligned notes...")
        
        variant_stats = {
            'orthographic': 0,
            'lexical': 0,
            'substitution': 0,
            'addition': 0,
            'deletion': 0
        }
        
        for i, alignment in enumerate(alignments):
            if i % 50 == 0:
                print(f"  Processing {i+1}/{len(alignments)}...")
            
            unified = self.build_unified_text(
                alignment.get('1808'),
                alignment.get('1826'),
                alignment.get('1849')
            )
            
            for seg in unified:
                if seg.get('category') and seg['category'] in variant_stats:
                    variant_stats[seg['category']] += 1
            
            notes_with_pos_1808 = []
            notes_with_pos_1826 = []
            notes_with_pos_1849 = []
            
            elem_1808 = alignment.get('1808_element')
            elem_1826 = alignment.get('1826_element')
            elem_1849 = alignment.get('1849_element')
            
            if elem_1808 is not None:
                notes_with_pos_1808 = self.extract_note_positions_from_paragraph(elem_1808, '1808')
            if elem_1826 is not None:
                notes_with_pos_1826 = self.extract_note_positions_from_paragraph(elem_1826, '1826')
            if elem_1849 is not None:
                notes_with_pos_1849 = self.extract_note_positions_from_paragraph(elem_1849, '1849')
            
            note_positions = {}
            if alignment.get('1808') and notes_with_pos_1808:
                note_positions['1808'] = self.map_note_positions_to_tokens(alignment['1808'], notes_with_pos_1808)
            if alignment.get('1826') and notes_with_pos_1826:
                note_positions['1826'] = self.map_note_positions_to_tokens(alignment['1826'], notes_with_pos_1826)
            if alignment.get('1849') and notes_with_pos_1849:
                note_positions['1849'] = self.map_note_positions_to_tokens(alignment['1849'], notes_with_pos_1849)
            
            aligned_notes = self.align_notes(notes_with_pos_1808, notes_with_pos_1826, notes_with_pos_1849)
            
            unified_notes = []
            for note_alignment in aligned_notes:
                unified_note = self.build_note_unified_text(
                    note_alignment.get('1808'),
                    note_alignment.get('1826'),
                    note_alignment.get('1849')
                )
                unified_notes.append(unified_note)
            
            results.append({
                'index': alignment['index'],
                'data': {
                    'unified_text': unified,
                    'originals': {
                        '1808': alignment.get('1808', ''),
                        '1826': alignment.get('1826', ''),
                        '1849': alignment.get('1849', '')
                    },
                    'notes': unified_notes,
                    'note_positions': note_positions,
                    'scores': alignment.get('scores', {}),
                    'new_in_1849': alignment.get('new_in_1849', False)
                }
            })
        
        output = {
            'metadata': {
                'witnesses': [
                    {'year': '1808', 'color': '#3498db', 'label': '1. Ausgabe (Tübingen 1808)'},
                    {'year': '1826', 'color': '#e74c3c', 'label': '2. Ausgabe (1826)'},
                    {'year': '1849', 'color': '#2c3e50', 'label': '3. Ausgabe (1849)'}
                ],
                'total_paragraphs': len(results),
                'variant_statistics': variant_stats
            },
            'content': results
        }
        
        with open('comparison_provenance.json', 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        
        print(f"\n{'='*60}")
        print(f"✓ Generated comparison_provenance.json")
        print(f"  {len(results)} paragraph alignments")
        print(f"\nVariant statistics:")
        for vtype, count in variant_stats.items():
            print(f"  {vtype:15s}: {count:5d}")
        print('='*60)

def main():
    print("Humboldt Analysis with Note Similarity Scores")
    print("="*60)
    
    analyzer = FinalAnalyzerWithAlignedNotes()
    
    files = {}
    for path in Path('.').glob('*.xml'):
        name = path.name.lower()
        if '1808' in name:
            files['1808'] = str(path)
        elif '1826' in name:
            files['1826'] = str(path)
        elif '1849' in name:
            files['1849'] = str(path)
    
    for year, filepath in files.items():
        if filepath:
            analyzer.load_tei(filepath, year)
    
    analyzer.analyze()

if __name__ == '__main__':
    main()

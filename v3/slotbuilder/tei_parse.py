import xml.etree.ElementTree as ET

NS = {"tei": "http://www.tei-c.org/ns/1.0"}

def extract_l_elements(root):
    """Extract all <l> elements from TEI XML root."""
    return root.findall(".//tei:body//tei:l", NS)
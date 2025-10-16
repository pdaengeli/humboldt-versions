<?xml version="1.0" encoding="UTF-8"?>
<xsl:transform xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:xd="http://www.oxygenxml.com/ns/doc/xsl"
  exclude-result-prefixes="xs xd"
  expand-text="true"
  version="3.0">
  <xd:doc scope="stylesheet">
    <xd:desc>
      <xd:p><xd:b>Created on:</xd:b> Nov 13, 2024</xd:p>
      <xd:p><xd:b>Author:</xd:b> pd</xd:p>
      <xd:p>
      
      </xd:p>
    </xd:desc>
  </xd:doc>
  
  <xsl:mode on-no-match="shallow-copy"/>
  
  <xd:doc>
    <xd:desc>Replace note element by superscript numeric note marker.</xd:desc>
  </xd:doc>
  <!--<xsl:template match="note[ancestor::div[not(contains(head,'Erläuterungen'))]]">-->
  <xsl:template match="note[not(p)]">  
    <xsl:text>{@n => translate('0123456789)','⁰¹²³⁴⁵⁶⁷⁸⁹⁾')}</xsl:text>
    <!--<xsl:text>[^{@n}]</xsl:text>-->
  </xsl:template>
  
  <xd:doc>
    <xd:desc>Remove leading space before note elements.</xd:desc>
  </xd:doc>
  <!--<xsl:template match="text()[matches(.,'\s$') and following-sibling::*[1][self::note][ancestor::div[not(contains(head,'Erläuterungen'))]]]">-->
  <xsl:template match="text()[matches(.,'\s$') and following-sibling::*[1][self::note][not(p)]]">
    <xsl:sequence select=". => replace('\s$','')"/>
  </xsl:template>
  
  <xd:doc>
    <xd:desc>Notes</xd:desc>
  </xd:doc>
  <!--<xsl:template match="note[ancestor::div[contains(head,'Erläuterungen')]]">-->
  <xsl:template match="note[p]">
    <xsl:text>**Endnote {@n}**: </xsl:text>
    <!--<xsl:text>[^{@n}]: </xsl:text>-->
    <xsl:apply-templates/>
  </xsl:template>
  
</xsl:transform>
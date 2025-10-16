<?xml version="1.0" encoding="UTF-8"?>
<xsl:transform xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:xd="http://www.oxygenxml.com/ns/doc/xsl"
  exclude-result-prefixes="xs xd"
  expand-text="true"
  version="3.0">
  <xd:doc scope="stylesheet">
    <xd:desc>
      <xd:p><xd:b>Created on:</xd:b> Apr 29, 2025</xd:p>
      <xd:p><xd:b>Author:</xd:b> pd</xd:p>
      <xd:p>
      
      </xd:p>
    </xd:desc>
  </xd:doc>
  
  <xsl:output method="text" encoding="UTF-8"/>
  
  <xsl:mode on-no-match="shallow-copy"/>
  
  <!-- keep output small for now -->
  <xsl:template match="div[position() gt 3]"/>
  
  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <xsl:template match="head">
    <xsl:text># </xsl:text>
    <xsl:apply-templates/>
  </xsl:template>

  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <xsl:template match="titlePage//titlePart">
    <xsl:text># </xsl:text>
    <xsl:apply-templates/>
    <xsl:text>&#xA;</xsl:text>
  </xsl:template>
  

  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <xsl:template match="hi[@rendition='#i']">
    <xsl:text>*</xsl:text>
    <xsl:apply-templates/>
    <xsl:text>*</xsl:text>
  </xsl:template>
  
  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <!--<xsl:template match="hi[@rendition='#g']">
    <xsl:text></xsl:text>
    <xsl:apply-templates/>
    <xsl:text></xsl:text>
  </xsl:template>-->
  
  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <xsl:template match="lg">
    <xsl:apply-templates/>
  </xsl:template>

  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <xsl:template match="l">
    <xsl:text>  </xsl:text><!-- two em spaces -->
    <xsl:apply-templates/>
    <xsl:text>&#xA;</xsl:text>
  </xsl:template>

  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <xsl:template match="p">
    <xsl:apply-templates/>
    <xsl:text>&#xA;</xsl:text>
  </xsl:template>
  
  <xd:doc>
    <xd:desc></xd:desc>
  </xd:doc>
  <xsl:template match="milestone[@rendition='#hr' and @unit='section']">
    <xsl:text>&#xA;&#xA;</xsl:text>
    <xsl:text>---</xsl:text>
    <xsl:text>&#xA;&#xA;</xsl:text>
  </xsl:template>
  
</xsl:transform>
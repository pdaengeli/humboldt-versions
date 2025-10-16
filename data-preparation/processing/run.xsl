<?xml version="1.0" encoding="UTF-8"?>
<xsl:transform xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:xd="http://www.oxygenxml.com/ns/doc/xsl"
  xmlns:dsl="dsl.unibe.ch"
  exclude-result-prefixes="xs xd"
  expand-text="true"
  version="3.0"
  xmlns:oxy="http://www.oxygenxml.com/oxy">
  <xd:doc scope="stylesheet">
    <xd:desc>
      <xd:p><xd:b>Created on:</xd:b> Nov 11, 2024</xd:p>
      <xd:p><xd:b>Author:</xd:b> pd</xd:p>
      <xd:p></xd:p>
    </xd:desc>
  </xd:doc>
  
  <xsl:template name="xsl:initial-template">
    
    <xsl:variable name="basepath" select="base-uri() =>tokenize('/') => reverse() => tail() =>reverse() => string-join('/')"/>
    
    <xsl:for-each select="uri-collection($basepath||'/../input/catalog.xml')">
      
      <xsl:variable name="filename" as="xs:string" select="(. => tokenize('/'))[last()]"/>
      
      <!-- add a step to comment DTD declarations (using uparsed text)? or pre-process externally -->
      
      <!-- step 1 -->
      <!-- handle lb -->
      <xsl:variable name="step1" as="node()" select="dsl:step1(.)"/>
      <xsl:result-document href="{$basepath}/../output/step1/{$filename}">
        <xsl:sequence select="$step1"/>
      </xsl:result-document>
        
      <!-- step 2 -->
      <!-- handle pb -->
      <xsl:variable name="step2" as="node()" select="dsl:step2($step1)"/>
      <xsl:result-document href="{$basepath}/../output/step2/{$filename}">
        <xsl:sequence select="$step2"/>
      </xsl:result-document>
      
      <!-- step 3 -->
      <!-- normalize chars -->
      <xsl:variable name="step3" as="node()" select="dsl:step3($step2)"/>
      <xsl:result-document href="{$basepath}/../output/step3/{$filename}">
        <xsl:sequence select="$step3"/>
      </xsl:result-document>
      
    </xsl:for-each>
    
  </xsl:template>
  
  <xsl:function name="dsl:step1">
    <xsl:param name="uri" as="xs:anyURI"/>
      <xsl:sequence select="transform(
        map {
        'stylesheet-location' : 'util/handle-lb.xsl',
        'source-node'    : doc($uri)
        })?output
        "/>
  </xsl:function>
  
  <xsl:function name="dsl:step2">
    <xsl:param name="step1" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/handle-pb.xsl',
      'source-node'    : $step1
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:step3">
    <xsl:param name="step2" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/normalize-chars.xsl',
      'source-node'    : $step2
      })?output
      "/>
  </xsl:function>
  
  
  
      
      <!-- remove highlighting (initials) -->
      
      <!-- retain paragraphs (in some way) to facilitate paragraph-based output -->
      <!-- upward-project pages to allow page-based output (?); no, pages don't matter -->
      
      
      <!-- 
      
      <!-/- step 4 -/->
      <!-/- replace note elements by superscript numeric note markers based on @n -/->
      <xsl:variable name="step4" as="node()" select="dsl:step4($step3)"/>
      <xsl:result-document href="../output/step4/{$filename}">
        <xsl:sequence select="$step4"/>
      </xsl:result-document>
      
      <!-/- step 5 -/->
      <!-/- split by section -/->
      <xsl:variable name="step5" as="node()" select="dsl:step5($step4)"/>
      <xsl:result-document href="../output/step5/{$filename}">
        <xsl:sequence select="$step5"/>
      </xsl:result-document>
      
      <!-/- step 6 -/->
      <!-/- xml to markdown -/->
      <xsl:variable name="step6" as="node()" select="dsl:step6($step5)"/>
      <xsl:result-document href="../output/step6/{$filename => replace('.*_(\d{4}_.*$)','$1')}.txt" method="text" encoding="UTF-8">
        <xsl:sequence select="$step6"/>
      </xsl:result-document>
      
      
      <xsl:function name="dsl:step4">
        <xsl:param name="step3" as="node()"/>
        <xsl:sequence select="transform(
          map {
          'stylesheet-location' : 'util/handle-note.xsl',
          'source-node'    : $step3
          })?output
          "/>
      </xsl:function>
      
      <xsl:function name="dsl:step5">
        <xsl:param name="step4" as="node()"/>
        <xsl:sequence select="transform(
          map {
          'stylesheet-location' : 'util/split-by-section.xsl',
          'source-node'    : $step4
          })?output
          "/>
      </xsl:function>
      
      <xsl:function name="dsl:step6">
        <xsl:param name="step5" as="node()"/>
        <xsl:sequence select="transform(
          map {
          'stylesheet-location' : 'util/derive-text.xsl',
          'source-node'    : $step5
          })?output
          "/>
      </xsl:function>
          
      -->
      
      
</xsl:transform>
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
      
      
      <!-- lera 0 -->
      <!-- insert anchors -->
      <!--<xsl:message select="$filename||', step 0…'"/>
      <xsl:variable name="step0" as="node()" select="dsl:step0(.)"/>
      <xsl:result-document href="{$basepath}/../output/step0/{$filename}">
        <xsl:sequence select="$step0"/>
      </xsl:result-document>-->
      
      <!-- step 1 -->
      <!-- handle „ directly following lb -->
      <xsl:message select="$filename||', step 1…'"/>
<!--      <xsl:variable name="step1" as="node()" select="dsl:step1($step0)"/>-->
      <xsl:variable name="step1" as="node()" select="dsl:step1(.)"/>
      <xsl:result-document href="{$basepath}/../output/step1/{$filename}">
        <xsl:sequence select="$step1"/>
      </xsl:result-document>
      
      <!-- step 2 -->
      <!-- handle lb -->
      <xsl:message select="$filename||', step 2…'"/>
      <xsl:variable name="step2" as="node()" select="dsl:step2($step1)"/>
      <xsl:result-document href="{$basepath}/../output/step2/{$filename}">
        <xsl:sequence select="$step2"/>
      </xsl:result-document>
      
      <!-- step 3 -->
      <!-- handle pb -->
      <xsl:message select="$filename||', step 3…'"/>
      <xsl:variable name="step3" as="node()" select="dsl:step3($step2)"/>
      <xsl:result-document href="{$basepath}/../output/step3/{$filename}">
        <xsl:sequence select="$step3"/>
      </xsl:result-document>
      
      <!-- step 4 -->
      <!-- normalize chars -->
      <xsl:message select="$filename||', step 4…'"/>
      <xsl:variable name="step4" as="node()" select="dsl:step3($step3)"/>
      <xsl:result-document href="{$basepath}/../output/step4/{$filename}">
        <xsl:sequence select="$step4"/>
      </xsl:result-document>
      
      <!-- step 5 -->
      <!-- structure title page -->
      <xsl:message select="$filename||', step 5…'"/>
      <xsl:variable name="step5" as="node()" select="dsl:step5($step4)"/>
      <xsl:result-document href="{$basepath}/../output/step5/{$filename}">
        <xsl:sequence select="$step5"/>
      </xsl:result-document>
      
      <!-- lera 1 -->
      <!-- emphasis / typography (this facilitates rendering in LERA but is of
           no concern for the LERA export) 
      -->
      <xsl:message select="$filename||', lera 1…'"/>
      <xsl:variable name="lera1" as="node()" select="dsl:lera1($step5)"/>
      <xsl:result-document href="{$basepath}/../output/lera1/{$filename}">
        <xsl:sequence select="$lera1"/>
      </xsl:result-document>
      
      <!-- lera 2 -->
      <!-- restructuring for better segmentation and alignment -->
      <xsl:message select="$filename||', lera 2…'"/>
      <xsl:variable name="lera2" as="node()" select="dsl:lera2($lera1)"/>
      <xsl:result-document href="{$basepath}/../output/lera2/{$filename}">
        <xsl:sequence select="$lera2"/>
      </xsl:result-document>
      
      <!-- lera 3 -->
      <!-- notes to p -->
      <xsl:message select="$filename||', lera 3…'"/>
      <xsl:variable name="lera3" as="node()" select="dsl:lera3($lera2)"/>
      <xsl:result-document href="{$basepath}/../output/lera3/{$filename}">
        <xsl:sequence select="$lera3"/>
      </xsl:result-document>
      
      <!-- lera 4 -->
      <!-- TODO: offset computation (needs doing before note handling) -->
      <xsl:message select="$filename||', lera 4…'"/>
      <xsl:variable name="lera4" as="node()" select="dsl:lera4($lera3)"/>
      <xsl:result-document href="{$basepath}/../output/lera4/{$filename}">
        <xsl:sequence select="$lera4"/>
      </xsl:result-document>
      
      <!-- lera 5 -->
      <!-- convert note markers and note boundaries to plain text markers -->
      <xsl:message select="$filename||', lera 5…'"/>
      <xsl:variable name="lera5" as="node()" select="dsl:lera5($lera4)"/>
      <xsl:result-document href="{$basepath}/../output/lera5/{$filename}">
        <xsl:sequence select="$lera5"/>
      </xsl:result-document>
      
      <!-- lera 6 -->
      <!-- remove distracting section anchors (information flows via metamarks) -->
      <xsl:message select="$filename||', lera 6…'"/>
      <xsl:variable name="lera6" as="node()" select="dsl:lera6($lera5)"/>
      <xsl:result-document href="{$basepath}/../output/lera6/{$filename}">
        <xsl:sequence select="$lera6"/>
      </xsl:result-document>
      
    </xsl:for-each>
    
  </xsl:template>
  
  <!-- no longer needed with stable data files -->
  <!--<xsl:function name="dsl:step0">
    <xsl:param name="uri" as="xs:anyURI"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/insert-anchors.xsl',
      'source-node'    : doc($uri)
      })?output
      "/>
  </xsl:function>-->
  
  <xsl:function name="dsl:step1">
<!--    <xsl:param name="step0" as="node()"/>-->
    <xsl:param name="uri" as="xs:anyURI"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/handle-repeat-quotes.xsl',
      (:'source-node'    : $step0:)
      'source-node'    : doc($uri)
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:step2">
    <xsl:param name="step1" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/handle-lb.xsl',
      'source-node'    : $step1
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:step3">
    <xsl:param name="step2" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/handle-pb.xsl',
      'source-node'    : $step2
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:step4">
    <xsl:param name="step3" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/normalize-chars.xsl',
      'source-node'    : $step3
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:step5">
    <xsl:param name="step4" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/structure-title-page.xsl',
      'source-node'    : $step4
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:lera1">
    <xsl:param name="step5" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/lera-typography.xsl',
      'source-node'    : $step5
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:lera2">
    <xsl:param name="lera1" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/lera-restructure.xsl',
      'source-node'    : $lera1
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:lera3">
    <xsl:param name="lera2" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/lera-note-to-p.xsl',
      'source-node'    : $lera2
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:lera4">
    <xsl:param name="lera3" as="node()"/>
    <!-- TODO: offset computation 
      LERA doesn't support exporting formatting in Versioning Machine format
      For this reason we generate a sidecar JSON from which the frontend can
      apply styles based on character offsets (per paragraph).
    -->
    <xsl:sequence select="$lera3"/>
  </xsl:function>
  
  <xsl:function name="dsl:lera5">
    <xsl:param name="lera4" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/lera-handle-notes.xsl',
      'source-node'    : $lera4
      })?output
      "/>
  </xsl:function>
  
  <xsl:function name="dsl:lera6">
    <xsl:param name="lera5" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/lera-remove-section-anchors.xsl',
      'source-node'    : $lera5
      })?output
      "/>
  </xsl:function>
  
  <!--<xsl:function name="dsl:lera6">
    <xsl:param name="lera5" as="node()"/>
    <xsl:sequence select="transform(
      map {
      'stylesheet-location' : 'util/lera-add-ids.xsl',
      'source-node'    : $lera5
      })?output
      "/>
  </xsl:function>-->
  
  
  
  
  
  
  
  
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
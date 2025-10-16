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
        
      <![CDATA[
      Für die automatisierte Auflösung des Zeilenfalls haben wir die line-breaks differenziert 
      codieren lassen: Zeilenumbruch ohne Worttrennung ist mit <lb break="yes“/> codiert, also 
      z. B. „dem<lb break="yes“/>Mond“. Zeilenumbruch mit Worttrennung ist mit  <lb break="no“/> 
      codiert, also z. B. „Thermo-<lb break="no“/>meter“. Bei der Auflösung der Zeilentrennung 
      kann das tag <lb break="yes"/> einfach durch ein Leerzeichen ersetzt werden, während beim 
      tag <lb break="no"/> einfach der Bindestrich gelöscht wird. Zeilenumbrüche, bei denen der 
      Bindestrich erhalten werden muss, weil er nicht durch Worttrennung entsteht, sondern durch 
      ein Kompositum, sind mit <lb break="maybe“/> codiert, also z. B. „Französisch-<lb break=
      "maybe"/>Guyana“ oder „rot-<lb break="maybe“/>gelb“. In diesem Fällen muss der Bindestrich 
      bei der Auflösung des Zeilenfalls bewahrt werden.
      ]]>
        
      </xd:p>
    </xd:desc>
  </xd:doc>
  
  <xsl:mode on-no-match="shallow-copy"/>
  
  <xd:doc>
    <xd:desc>Replace `lb[@break='yes']` by space (U+0020).</xd:desc>
  </xd:doc>
  <xsl:template match="lb[@break='yes']">
    <xsl:text>&#x0020;</xsl:text>
  </xsl:template>
  
  <xd:doc>
    <xd:desc>Eliminate hyphenation characters (-) when followed by `lb[@break='no']`.</xd:desc>
  </xd:doc>
  <xsl:template match="text()[matches(.,'.*-$')][following-sibling::*[1]/self::lb[@break='no']]">
    <xsl:analyze-string select="." regex="-$">
      <xsl:matching-substring/>
      <xsl:non-matching-substring>{.}</xsl:non-matching-substring>
    </xsl:analyze-string>
  </xsl:template>
  
  <xd:doc>
    <xd:desc>Eliminate `lb` milestone element.</xd:desc>
  </xd:doc>
  <xsl:template match="lb[@break='no']"/>
  
  <xd:doc>
    <xd:desc>Eliminate `lb` milestone element.</xd:desc>
  </xd:doc>
  <xsl:template match="lb[@break='maybe']"/>
  
  
</xsl:transform>
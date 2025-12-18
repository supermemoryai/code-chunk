import { chunk } from '../src'
import { chunkFixed } from './chunkers/fixed'
import { readFileSync } from 'fs'
import { join } from 'path'

// Check deepmind_tracr/tracr/craft/transformers.py
// Assume we're looking for lines 100-150
const testFile = join(import.meta.dir, 'data/repoeval/repositories/function_level/deepmind_tracr/tracr/craft/transformers.py')
const code = readFileSync(testFile, 'utf-8')
const targetStart = 100
const targetEnd = 150

console.log('File:', testFile)
console.log('Target lines:', targetStart, '-', targetEnd)
console.log('')

function countNws(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 32) count++
  }
  return count
}

function overlaps(chunkStart: number, chunkEnd: number, tStart: number, tEnd: number): boolean {
  return !(chunkEnd < tStart || chunkStart > tEnd)
}

for (const maxSize of [1500, 1800]) {
  console.log(`\n=== Max chunk size: ${maxSize} ===`)
  
  const astChunks = await chunk(testFile, code, { maxChunkSize: maxSize })
  const fixedChunks = chunkFixed(code, maxSize)
  
  console.log('\nAST chunks:')
  for (const c of astChunks) {
    const overlap = overlaps(c.lineRange.start, c.lineRange.end, targetStart, targetEnd)
    console.log(`  Lines ${c.lineRange.start}-${c.lineRange.end} (${countNws(c.text)} NWS) ${overlap ? '*** RELEVANT ***' : ''}`)
  }
  
  console.log('\nFixed chunks:')
  for (const c of fixedChunks) {
    const overlap = overlaps(c.startLine, c.endLine, targetStart, targetEnd)
    console.log(`  Lines ${c.startLine}-${c.endLine} (${c.nwsCount} NWS) ${overlap ? '*** RELEVANT ***' : ''}`)
  }
  
  const astRelevant = astChunks.filter(c => overlaps(c.lineRange.start, c.lineRange.end, targetStart, targetEnd))
  const fixedRelevant = fixedChunks.filter(c => overlaps(c.startLine, c.endLine, targetStart, targetEnd))
  
  console.log(`\nRelevant chunks: AST=${astRelevant.length}, Fixed=${fixedRelevant.length}`)
  console.log(`Total chunks: AST=${astChunks.length}, Fixed=${fixedChunks.length}`)
}

/**
 * Chonkie CodeChunker wrapper for evaluation
 *
 * Wraps the Chonkie Python library's CodeChunker for use in the evaluation harness.
 * Calls the Python script via subprocess.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

const EVAL_DIR = dirname(import.meta.dir)
const PYTHON_PATH = join(EVAL_DIR, '.venv', 'bin', 'python')
const SCRIPT_PATH = join(import.meta.dir, 'chonkie_chunk.py')

interface ChunkResult {
	id: string
	text: string
	startLine: number
	endLine: number
}

/**
 * Chunk a file using Chonkie's CodeChunker and return results
 * in a format compatible with the evaluation
 *
 * @param filepath - Path to the file
 * @param code - Source code content
 * @param maxChunkSize - Maximum characters per chunk (default: 1500)
 */
export async function chunkFile(
	filepath: string,
	code: string,
	maxChunkSize: number = 1500,
): Promise<ChunkResult[]> {
	return new Promise((resolve, reject) => {
		const proc = spawn(
			PYTHON_PATH,
			[SCRIPT_PATH, filepath, String(maxChunkSize)],
			{
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		)

		let stdout = ''
		let stderr = ''

		proc.stdout.on('data', (data) => {
			stdout += data.toString()
		})

		proc.stderr.on('data', (data) => {
			stderr += data.toString()
		})

		proc.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Chonkie chunker failed: ${stderr}`))
				return
			}

			try {
				const result = JSON.parse(stdout)
				if (result.error) {
					reject(new Error(`Chonkie error: ${result.error}`))
					return
				}
				resolve(result)
			} catch {
				reject(new Error(`Failed to parse Chonkie output: ${stdout}`))
			}
		})

		proc.on('error', (err) => {
			reject(err)
		})

		// Write code to stdin
		proc.stdin.write(code)
		proc.stdin.end()
	})
}

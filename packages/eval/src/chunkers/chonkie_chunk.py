#!/usr/bin/env python3
"""
Chonkie CodeChunker wrapper for evaluation.

Takes filepath, code, and max_chunk_size as arguments.
Outputs JSON array of chunks with id, text, startLine, endLine.
"""

import json
import sys
from chonkie import CodeChunker


def count_nws(text: str) -> int:
    """Count non-whitespace characters to match the evaluation's sizing."""
    return sum(1 for c in text if not c.isspace())


def main():
    if len(sys.argv) < 3:
        print("Usage: chonkie_chunk.py <filepath> <max_chunk_size>", file=sys.stderr)
        print("Code is read from stdin", file=sys.stderr)
        sys.exit(1)

    filepath = sys.argv[1]
    max_chunk_size = int(sys.argv[2])
    
    # Read code from stdin to handle large files and special characters
    code = sys.stdin.read()
    
    # Determine language from file extension
    ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
    lang_map = {
        "py": "python",
        "js": "javascript",
        "ts": "typescript",
        "tsx": "tsx",
        "jsx": "javascript",
        "rs": "rust",
        "go": "go",
        "java": "java",
        "c": "c",
        "cpp": "cpp",
        "h": "c",
        "hpp": "cpp",
        "rb": "ruby",
        "php": "php",
        "cs": "c_sharp",
        "swift": "swift",
        "kt": "kotlin",
        "scala": "scala",
    }
    
    language = lang_map.get(ext, "python")  # Default to python for .py files
    
    try:
        # Initialize CodeChunker with character tokenizer to match NWS-based sizing
        # Use a simple character-based token counter
        chunker = CodeChunker(
            tokenizer_or_token_counter=lambda x: len(x),  # Character count
            chunk_size=max_chunk_size,
            language=language,
            include_nodes=False,
        )
        
        chunks = chunker.chunk(code)
        
        # Convert to evaluation format
        results = []
        lines = code.split("\n")
        
        for chunk in chunks:
            # Find line numbers from start/end indices
            start_line = code[:chunk.start_index].count("\n")
            end_line = code[:chunk.end_index].count("\n")
            
            results.append({
                "id": f"{filepath}:{start_line}-{end_line}",
                "text": chunk.text,
                "startLine": start_line,
                "endLine": end_line,
            })
        
        print(json.dumps(results))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

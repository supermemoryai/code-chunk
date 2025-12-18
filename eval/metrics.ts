/**
 * Information Retrieval metrics
 *
 * Implements nDCG, Precision, and Recall at k
 */

/**
 * Compute Precision@k
 *
 * Precision = (# of relevant items in top-k) / k
 */
export function precisionAtK(
	retrieved: string[],
	relevant: Set<string>,
	k: number,
): number {
	const topK = retrieved.slice(0, k)
	const hits = topK.filter((id) => relevant.has(id)).length
	return hits / k
}

/**
 * Compute Recall@k
 *
 * Recall = (# of relevant items in top-k) / (total # of relevant items)
 */
export function recallAtK(
	retrieved: string[],
	relevant: Set<string>,
	k: number,
): number {
	if (relevant.size === 0) return 0

	const topK = retrieved.slice(0, k)
	const hits = topK.filter((id) => relevant.has(id)).length
	return hits / relevant.size
}

/**
 * Compute Discounted Cumulative Gain (DCG)
 *
 * DCG = sum(rel_i / log2(i + 1)) for i in 1..k
 * Using binary relevance (rel = 1 if relevant, 0 otherwise)
 */
function dcg(retrieved: string[], relevant: Set<string>, k: number): number {
	let score = 0
	const topK = retrieved.slice(0, k)

	for (let i = 0; i < topK.length; i++) {
		const rel = relevant.has(topK[i]) ? 1 : 0
		// i+1 because DCG uses 1-indexed positions
		// i+2 in denominator because log2(1) = 0
		score += rel / Math.log2(i + 2)
	}

	return score
}

/**
 * Compute Ideal DCG (DCG with perfect ranking)
 */
function idcg(relevantCount: number, k: number): number {
	let score = 0
	const n = Math.min(relevantCount, k)

	for (let i = 0; i < n; i++) {
		score += 1 / Math.log2(i + 2)
	}

	return score
}

/**
 * Compute Normalized Discounted Cumulative Gain (nDCG@k)
 *
 * nDCG = DCG / IDCG
 */
export function ndcgAtK(
	retrieved: string[],
	relevant: Set<string>,
	k: number,
): number {
	const dcgScore = dcg(retrieved, relevant, k)
	const idcgScore = idcg(relevant.size, k)

	if (idcgScore === 0) return 0

	return dcgScore / idcgScore
}

/**
 * Compute all metrics at once
 */
export function computeMetrics(
	retrieved: string[],
	relevant: Set<string>,
	k: number,
): { precision: number; recall: number; ndcg: number } {
	return {
		precision: precisionAtK(retrieved, relevant, k),
		recall: recallAtK(retrieved, relevant, k),
		ndcg: ndcgAtK(retrieved, relevant, k),
	}
}

/**
 * Aggregate metrics across multiple queries
 */
export function aggregateMetrics(
	allMetrics: Array<{ precision: number; recall: number; ndcg: number }>,
): { precision: number; recall: number; ndcg: number } {
	const n = allMetrics.length
	if (n === 0) {
		return { precision: 0, recall: 0, ndcg: 0 }
	}

	const sum = allMetrics.reduce(
		(acc, m) => ({
			precision: acc.precision + m.precision,
			recall: acc.recall + m.recall,
			ndcg: acc.ndcg + m.ndcg,
		}),
		{ precision: 0, recall: 0, ndcg: 0 },
	)

	return {
		precision: sum.precision / n,
		recall: sum.recall / n,
		ndcg: sum.ndcg / n,
	}
}

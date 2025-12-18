/**
 * Retrieval metrics for evaluation
 *
 * Computes precision, recall, and nDCG for retrieval evaluation.
 */

/**
 * Compute precision, recall, and nDCG for a single query
 *
 * @param retrievedIds - Ordered list of retrieved chunk IDs
 * @param relevantSet - Set of relevant (ground truth) chunk IDs
 * @param k - Number of results to consider
 */
export function computeMetrics(
	retrievedIds: string[],
	relevantSet: Set<string>,
	k: number,
): { precision: number; recall: number; ndcg: number } {
	const topK = retrievedIds.slice(0, k)

	// Precision@k: fraction of retrieved that are relevant
	const relevantInTopK = topK.filter((id) => relevantSet.has(id)).length
	const precision = relevantInTopK / k

	// Recall@k: fraction of relevant that are retrieved
	const recall = relevantSet.size > 0 ? relevantInTopK / relevantSet.size : 0

	// nDCG@k: normalized discounted cumulative gain
	const dcg = topK.reduce((sum, id, i) => {
		const rel = relevantSet.has(id) ? 1 : 0
		return sum + rel / Math.log2(i + 2) // i+2 because log2(1) = 0
	}, 0)

	// Ideal DCG: all relevant docs at top
	const idealK = Math.min(k, relevantSet.size)
	const idcg = Array.from({ length: idealK }).reduce<number>(
		(sum, _, i) => sum + 1 / Math.log2(i + 2),
		0,
	)

	const ndcg = idcg > 0 ? dcg / idcg : 0

	return { precision, recall, ndcg }
}

/**
 * Aggregate metrics across multiple queries
 *
 * @param metrics - Array of metric objects
 */
export function aggregateMetrics(
	metrics: Array<{ precision: number; recall: number; ndcg: number }>,
): { precision: number; recall: number; ndcg: number } {
	if (metrics.length === 0) {
		return { precision: 0, recall: 0, ndcg: 0 }
	}

	const sum = metrics.reduce(
		(acc, m) => ({
			precision: acc.precision + m.precision,
			recall: acc.recall + m.recall,
			ndcg: acc.ndcg + m.ndcg,
		}),
		{ precision: 0, recall: 0, ndcg: 0 },
	)

	return {
		precision: sum.precision / metrics.length,
		recall: sum.recall / metrics.length,
		ndcg: sum.ndcg / metrics.length,
	}
}

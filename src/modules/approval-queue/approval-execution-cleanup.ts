export async function closeAfterApprovalExecutionFailure(
	close: () => Promise<void>,
	primaryError: Error,
	message: string,
): Promise<void> {
	try {
		await close();
	} catch (cleanupError) {
		throw new AggregateError([primaryError, cleanupError], message);
	}
}

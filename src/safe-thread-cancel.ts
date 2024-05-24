//!native
//!nonstrict
//!optimize 2

export default function safeThreadCancel(thread: thread) {
	let cancelled: boolean | undefined;
	if (coroutine.running() !== thread) [cancelled] = pcall(() => task.cancel(thread));

	if (!cancelled) {
		const toCancel = thread;
		task.defer(() => task.cancel(toCancel));
	}
}

export default async function* reporter(source) {
  for await (const event of source) {
    if (!["test:pass", "test:fail", "test:summary"].includes(event.type)) continue;
    const { name, nesting, file, details, skip, todo, counts } = event.data;
    yield JSON.stringify({ type: event.type, name, nesting, file, skip, todo, counts,
      details: details && { duration_ms: details.duration_ms, type: details.type, error: details.error && { message: details.error.message, stack: details.error.stack, failureType: details.error.failureType } } }) + "\n";
  }
}

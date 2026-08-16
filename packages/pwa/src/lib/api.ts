/**
 * HTTP API client for pairing and health checks.
 */

export async function pairWithBridge(baseUrl: string, code: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
  }

  const data = (await response.json()) as { token: string };
  return data.token;
}

export async function checkHealth(baseUrl: string): Promise<{ status: string; version: string; clients: number }> {
  const response = await fetch(`${baseUrl}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<{ status: string; version: string; clients: number }>;
}

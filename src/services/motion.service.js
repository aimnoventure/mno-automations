import axios from "axios";

const MOTION_BASE_URL = "https://api.usemotion.com/v1";

/**
 * Fetches the latest task from a Motion workspace, sorted by createdTime descending.
 * Returns null (instead of throwing) so the title pipeline can continue without Motion.
 *
 * @param {{ apiKey: string, workspaceId: string }} motionConfig
 * @returns {Promise<{ name: string, description: string, createdTime: string } | null>}
 */
export async function getLatestMotionTask(motionConfig) {
  if (!motionConfig?.apiKey || !motionConfig?.workspaceId) {
    console.warn("[motion] Missing apiKey or workspaceId — skipping Motion fetch");
    return null;
  }

  try {
    const response = await axios.get(`${MOTION_BASE_URL}/tasks`, {
      headers: { "X-API-Key": motionConfig.apiKey },
      params: { workspaceId: motionConfig.workspaceId },
      timeout: 10_000,
    });

    const tasks = response.data?.tasks || [];
    if (!tasks.length) {
      console.warn("[motion] No tasks found in workspace");
      return null;
    }

    tasks.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
    const latest = tasks[0];

    const description = (latest.description || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    console.log(`[motion] Fetched latest task: "${latest.name}" (created: ${latest.createdTime})`);

    return {
      name: latest.name,
      description,
      createdTime: latest.createdTime,
    };
  } catch (err) {
    console.error("[motion] Failed to fetch latest task:", err.message);
    return null;
  }
}

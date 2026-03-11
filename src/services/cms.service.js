import axios from "axios";

const TIMEOUT_MS = 30_000;

/**
 * Creates a private WordPress post via the WordPress REST API.
 *
 * The post is created with status "private" — visible only to admins/editors
 * when logged in, not published to public visitors. This allows review before
 * publishing.
 *
 * Authentication uses HTTP Basic Auth with a WordPress Application Password
 * (generated under WP Admin → Users → Profile → Application Passwords).
 *
 * @param {Object} postData - The content fields for the new post
 * @param {string} postData.title - Post title
 * @param {string} postData.content - Post HTML body content
 * @param {string} postData.slug - URL slug
 * @param {Object} cmsConfig - CMS configuration from the brand config
 * @param {string} cmsConfig.url - WordPress site URL, no trailing slash (e.g. https://achora.com.au)
 * @param {string} cmsConfig.username - WordPress application username
 * @param {string} cmsConfig.appPassword - WordPress application password
 * @returns {Promise<Object>} Full WordPress REST API response — caller needs .id and .guid.rendered
 * @throws {Error} If the API call fails or returns a non-2xx status
 */
export async function createPrivatePost(postData, cmsConfig) {
  const { title, content, slug } = postData;
  const { url, username, appPassword } = cmsConfig;

  const credentials = Buffer.from(`${username}:${appPassword}`).toString("base64");

  const response = await axios.post(
    `${url}/wp-json/wp/v2/posts`,
    {
      title,
      content,
      slug,
      status: "private",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      timeout: TIMEOUT_MS,
    }
  );

  return response.data;
}

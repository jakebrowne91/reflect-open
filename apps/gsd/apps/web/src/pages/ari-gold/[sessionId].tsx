import type { GetServerSideProps } from "next";

const DEFAULT_RETROGRADE_ADMIN_APP_URL =
  "https://admin.creatorcomputecompany.com";

function getRetrogradeAdminRootUrl() {
  return (
    process.env.NEXT_PUBLIC_RETROGRADE_ADMIN_APP_URL ??
    process.env.RETROGRADE_ADMIN_APP_URL ??
    DEFAULT_RETROGRADE_ADMIN_APP_URL
  )
    .replace(/\/+$/, "")
    .replace(/\/gsd$/, "");
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const sessionId =
    typeof params?.sessionId === "string" ? params.sessionId : "";

  return {
    redirect: {
      destination: `${getRetrogradeAdminRootUrl()}/ari-gold/${encodeURIComponent(
        sessionId,
      )}`,
      permanent: false,
    },
  };
};

export default function AriGoldSessionRedirect() {
  return null;
}

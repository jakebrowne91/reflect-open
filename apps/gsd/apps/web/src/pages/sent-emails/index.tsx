import type { NextPageWithLayout } from "../_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import SentEmailsView from "~/views/sentEmails";

const SentEmailsPage: NextPageWithLayout = () => {
  return (
    <>
      <SentEmailsView />
      <Popup />
    </>
  );
};

SentEmailsPage.getLayout = (page) => getDashboardLayout(page);

export default SentEmailsPage;

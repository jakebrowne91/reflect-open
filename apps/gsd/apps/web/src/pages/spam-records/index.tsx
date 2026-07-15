import type { NextPageWithLayout } from "../_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import SpamRecordsView from "~/views/spamRecords";

const SpamRecordsPage: NextPageWithLayout = () => {
  return (
    <>
      <SpamRecordsView />
      <Popup />
    </>
  );
};

SpamRecordsPage.getLayout = (page) => getDashboardLayout(page);

export default SpamRecordsPage;

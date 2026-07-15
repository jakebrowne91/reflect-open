import type { NextPageWithLayout } from "../_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import FeatureRequestsView from "~/views/featureRequests";

const FeatureRequestsPage: NextPageWithLayout = () => {
  return (
    <>
      <FeatureRequestsView />
      <Popup />
    </>
  );
};

FeatureRequestsPage.getLayout = (page) => getDashboardLayout(page);

export default FeatureRequestsPage;

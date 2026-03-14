import { 
  AppProvider, 
  Page, 
  Layout, 
  Card, 
  IndexTable, 
  Text, 
  Badge, 
  Button, 
  BlockStack, 
  InlineStack,
  Box
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useLoaderData, useSubmit, useSearchParams } from "react-router";
import db from "../db.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const userParam = url.searchParams.get("user");
  const pwParam = url.searchParams.get("pw");
  
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

  if (userParam !== ADMIN_USERNAME || pwParam !== ADMIN_PASSWORD) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shop = await db.shop.findUnique({
    where: { id: parseInt(params.id) }
  });

  if (!shop) {
    throw new Response("Not Found", { status: 404 });
  }

  const jobs = await db.uploadJob.findMany({
    where: { shop: shop.shop },
    orderBy: { createdAt: "desc" }
  });

  const totalImages = jobs.reduce((sum, job) => sum + job.imageCount, 0);

  return { shop, jobs, totalImages };
};

export const action = async ({ request, params }) => {
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "toggle_active") {
    const shop = await db.shop.findUnique({ where: { id: parseInt(params.id) } });
    await db.shop.update({
      where: { id: parseInt(params.id) },
      data: { isActive: !shop.isActive }
    });
    return { success: true };
  }
  return { success: false };
};

export default function ShopDetails() {
  const { shop, jobs, totalImages } = useLoaderData();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  const handleToggleActive = () => {
    const user = searchParams.get("user");
    const pw = searchParams.get("pw");
    submit({ actionType: "toggle_active", user, pw }, { method: "POST" });
  };

  const backUrl = `/super-admin?user=${searchParams.get("user")}&pw=${searchParams.get("pw")}`;

  return (
    <AppProvider i18n={enTranslations}>
      <Page 
        title={`Shop Details: ${shop.shop}`} 
        backAction={{ content: 'Back to Dashboard', url: backUrl }}
      >
        <BlockStack gap="500">
          <Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Status Control</Text>
                  <InlineStack align="space-between">
                    <Badge tone={shop.isActive ? "success" : "critical"}>
                      {shop.isActive ? "Account Active" : "Account Suspended"}
                    </Badge>
                    <Button 
                      variant="primary" 
                      tone={shop.isActive ? "critical" : "success"}
                      onClick={handleToggleActive}
                    >
                      {shop.isActive ? "Deactivate User" : "Activate User"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
            
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h6" tone="subdued">Total Uploads</Text>
                  <Text variant="headingLg" as="p">{totalImages} images</Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h6" tone="subdued">Total Jobs</Text>
                  <Text variant="headingLg" as="p">{jobs.length} executions</Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                   <Text as="h2" variant="headingMd">Execution History for {shop.shop}</Text>
                </Box>
                <IndexTable
                  resourceName={{ singular: 'job', plural: 'jobs' }}
                  itemCount={jobs.length}
                  headings={[
                    { title: 'Job ID' },
                    { title: 'Images' },
                    { title: 'Status' },
                    { title: 'Date' },
                  ]}
                  selectable={false}
                >
                  {jobs.map((job) => (
                    <IndexTable.Row key={job.id} id={job.id.toString()} position={job.id}>
                      <IndexTable.Cell>#{job.id}</IndexTable.Cell>
                      <IndexTable.Cell>{job.imageCount} images</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={
                          job.status === "COMPLETED" ? "success" : 
                          job.status === "FAILED" ? "critical" : "attention"
                        }>
                          {job.status}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {new Date(job.createdAt).toLocaleString()}
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
import { useState } from "react";
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
  TextField,
  FormLayout,
  InlineStack,
  Box
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useLoaderData, useSubmit, useActionData } from "react-router";
import db from "../db.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const password = url.searchParams.get("pw");
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

  if (password !== ADMIN_PASSWORD) {
    return { authorized: false };
  }

  const shops = await db.shop.findMany({
    orderBy: { createdAt: "desc" }
  });

  const uploadJobs = await db.uploadJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50
  });

  // Calculate stats for each shop
  const shopStats = await Promise.all(shops.map(async (shop) => {
    const jobs = await db.uploadJob.findMany({
      where: { shop: shop.shop }
    });
    const totalImages = jobs.reduce((sum, job) => sum + job.imageCount, 0);
    const failedJobs = jobs.filter(j => j.status === "FAILED").length;
    
    return {
      ...shop,
      totalJobs: jobs.length,
      totalImages,
      failedJobs
    };
  }));

  return { authorized: true, shopStats, latestJobs: uploadJobs };
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const shopId = formData.get("shopId");

  if (actionType === "toggle_active") {
    const shop = await db.shop.findUnique({ where: { id: parseInt(shopId) } });
    await db.shop.update({
      where: { id: parseInt(shopId) },
      data: { isActive: !shop.isActive }
    });
    return { success: true };
  }

  return { success: false };
};

export default function SuperAdmin() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const [pwInput, setPwInput] = useState("");

  if (!loaderData.authorized) {
    return (
      <AppProvider i18n={enTranslations}>
        <Page title="Super Admin Login">
          <Layout>
            <Layout.Section>
              <Card>
                <FormLayout>
                  <TextField
                    label="Admin Password"
                    type="password"
                    value={pwInput}
                    onChange={setPwInput}
                    autoComplete="off"
                  />
                  <Button 
                    variant="primary" 
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set("pw", pwInput);
                      window.location.href = url.toString();
                    }}
                  >
                    Login
                  </Button>
                </FormLayout>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </AppProvider>
    );
  }

  const { shopStats, latestJobs } = loaderData;

  const handleToggleActive = (shopId) => {
    const pw = new URL(window.location.href).searchParams.get("pw");
    submit({ actionType: "toggle_active", shopId, pw }, { method: "POST" });
  };

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="Super Admin Dashboard" backAction={{ content: 'Back', url: '/' }}>
        <BlockStack gap="500">
          <Layout>
            {/* Global Stats Summary */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Platform Overview</Text>
                  <InlineStack gap="1000">
                    <BlockStack>
                      <Text variant="headingSm" as="h6">Total Shops</Text>
                      <Text variant="headingLg" as="p">{shopStats.length}</Text>
                    </BlockStack>
                    <BlockStack>
                      <Text variant="headingSm" as="h6">Global Uploads</Text>
                      <Text variant="headingLg" as="p">
                        {shopStats.reduce((sum, s) => sum + s.totalImages, 0)} images
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Shop Management Table */}
            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                   <Text as="h2" variant="headingMd">Shop Management & Consumption</Text>
                </Box>
                <IndexTable
                  resourceName={{ singular: 'shop', plural: 'shops' }}
                  itemCount={shopStats.length}
                  headings={[
                    { title: 'Shop Domain' },
                    { title: 'Status' },
                    { title: 'Total Jobs' },
                    { title: 'Total Images' },
                    { title: 'Failed' },
                    { title: 'Action' },
                  ]}
                  selectable={false}
                >
                  {shopStats.map((shop) => (
                    <IndexTable.Row key={shop.id} id={shop.id} position={shop.id}>
                      <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="bold" as="span">{shop.shop}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={shop.isActive ? "success" : "critical"}>
                          {shop.isActive ? "Active" : "Deactivated"}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{shop.totalJobs}</IndexTable.Cell>
                      <IndexTable.Cell>{shop.totalImages}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text tone={shop.failedJobs > 0 ? "critical" : "subdued"}>
                          {shop.failedJobs}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button 
                          size="slim"
                          variant="secondary"
                          tone={shop.isActive ? "critical" : "success"}
                          onClick={() => handleToggleActive(shop.id)}
                        >
                          {shop.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </Card>
            </Layout.Section>

            {/* Global Logs / Recent Activity */}
            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                  <Text as="h2" variant="headingMd">Global Execution Logs (Last 50)</Text>
                </Box>
                <IndexTable
                  resourceName={{ singular: 'job', plural: 'jobs' }}
                  itemCount={latestJobs.length}
                  headings={[
                    { title: 'Job ID' },
                    { title: 'Shop' },
                    { title: 'Images' },
                    { title: 'Status' },
                    { title: 'Time' },
                  ]}
                  selectable={false}
                >
                  {latestJobs.map((job) => (
                    <IndexTable.Row key={job.id} id={job.id} position={job.id}>
                      <IndexTable.Cell>#{job.id}</IndexTable.Cell>
                      <IndexTable.Cell>{job.shop}</IndexTable.Cell>
                      <IndexTable.Cell>{job.imageCount}</IndexTable.Cell>
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
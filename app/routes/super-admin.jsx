import { useState, useMemo } from "react";
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
  Box,
  Filters,
  Link,
  Select
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useLoaderData, useSubmit, useActionData, useNavigate, useSearchParams } from "react-router";
import db from "../db.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const userParam = url.searchParams.get("user");
  const pwParam = url.searchParams.get("pw");
  
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

  if (userParam !== ADMIN_USERNAME || pwParam !== ADMIN_PASSWORD) {
    return { authorized: false };
  }

  const shops = await db.shop.findMany({
    orderBy: { createdAt: "desc" }
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

  return { authorized: true, shopStats };
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
  const submit = useSubmit();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [userInput, setUserInput] = useState("");
  const [pwInput, setPwInput] = useState("");

  // Search and Filter State
  const [queryValue, setQueryValue] = useState("");
  const [statusFilter, setStatusFilter] = useState(null);

  if (!loaderData.authorized) {
    return (
      <AppProvider i18n={enTranslations}>
        <Page title="Super Admin Login">
          <Layout>
            <Layout.Section>
              <Card>
                <FormLayout>
                  <TextField
                    label="Username"
                    value={userInput}
                    onChange={setUserInput}
                    autoComplete="username"
                  />
                  <TextField
                    label="Password"
                    type="password"
                    value={pwInput}
                    onChange={setPwInput}
                    autoComplete="current-password"
                  />
                  <Button 
                    variant="primary" 
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set("user", userInput);
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

  const { shopStats } = loaderData;

  const handleLogout = () => {
    window.location.href = "/super-admin";
  };

  const filteredShops = useMemo(() => {
    return shopStats.filter(shop => {
      const matchesQuery = shop.shop.toLowerCase().includes(queryValue.toLowerCase());
      const matchesStatus = statusFilter === null || 
        (statusFilter === 'active' && shop.isActive) || 
        (statusFilter === 'deactivated' && !shop.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [shopStats, queryValue, statusFilter]);

  const handleToggleActive = (shopId) => {
    const user = searchParams.get("user");
    const pw = searchParams.get("pw");
    submit({ actionType: "toggle_active", shopId, user, pw }, { method: "POST" });
  };

  return (
    <AppProvider i18n={enTranslations}>
      <Page 
        title="Super Admin Dashboard" 
        primaryAction={{ content: 'Logout', onAction: handleLogout, destructive: true }}
      >
        <BlockStack gap="500">
          <Layout>
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

            <Layout.Section>
              <Card padding="0">
                <Box padding="400">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">Shop Management</Text>
                    <Filters
                      queryValue={queryValue}
                      filters={[
                        {
                          key: 'status',
                          label: 'Status',
                          filter: (
                            <Select
                              label="Status"
                              labelHidden
                              options={[
                                {label: 'All', value: 'all'},
                                {label: 'Active', value: 'active'},
                                {label: 'Deactivated', value: 'deactivated'},
                              ]}
                              onChange={(val) => setStatusFilter(val === 'all' ? null : val)}
                              value={statusFilter || 'all'}
                            />
                          ),
                          shortcut: true,
                        },
                      ]}
                      onQueryChange={setQueryValue}
                      onQueryClear={() => setQueryValue("")}
                      onClearAll={() => {
                        setQueryValue("");
                        setStatusFilter(null);
                      }}
                    />
                  </BlockStack>
                </Box>
                <IndexTable
                  resourceName={{ singular: 'shop', plural: 'shops' }}
                  itemCount={filteredShops.length}
                  headings={[
                    { title: 'Shop Domain' },
                    { title: 'Status' },
                    { title: 'Total Jobs' },
                    { title: 'Total Images' },
                    { title: 'Action' },
                    { title: '' },
                  ]}
                  selectable={false}
                >
                  {filteredShops.map((shop) => (
                    <IndexTable.Row key={shop.id} id={shop.id.toString()} position={shop.id}>
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
                        <Button 
                          size="slim"
                          variant="secondary"
                          tone={shop.isActive ? "critical" : "success"}
                          onClick={() => handleToggleActive(shop.id)}
                        >
                          {shop.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Link 
                           url={`/super-admin/shop/${shop.id}?user=${searchParams.get("user")}&pw=${searchParams.get("pw")}`}
                        >
                          View Details
                        </Link>
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
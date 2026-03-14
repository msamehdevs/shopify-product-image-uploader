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
  Select,
  Link,
  Icon
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useLoaderData, useSubmit, useActionData, useNavigate, redirect } from "react-router";
import db from "../db.server";
import { getSession, commitSession, destroySession } from "../sessions.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const session = await getSession(request.headers.get("Cookie"));
  
  if (!session.has("adminAuthenticated")) {
    return { authorized: false };
  }

  const shops = await db.shop.findMany({
    orderBy: { createdAt: "desc" }
  });

  const shopStats = await Promise.all(shops.map(async (shop) => {
    const jobs = await db.uploadJob.findMany({
      where: { shop: shop.shop }
    });
    const totalImages = jobs.reduce((sum, job) => sum + job.imageCount, 0);
    return {
      ...shop,
      totalJobs: jobs.length,
      totalImages
    };
  }));

  return { authorized: true, shopStats };
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "login") {
    const username = formData.get("username");
    const password = formData.get("password");
    
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const session = await getSession(request.headers.get("Cookie"));
      session.set("adminAuthenticated", true);
      return redirect("/super-admin", {
        headers: { "Set-Cookie": await commitSession(session) },
      });
    }
    return { error: "Invalid credentials" };
  }

  if (actionType === "logout") {
    const session = await getSession(request.headers.get("Cookie"));
    return redirect("/super-admin", {
      headers: { "Set-Cookie": await destroySession(session) },
    });
  }

  if (actionType === "toggle_active") {
    const shopId = formData.get("shopId");
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
  
  const [userInput, setUserInput] = useState("");
  const [pwInput, setPwInput] = useState("");

  // Search and Filter State
  const [searchValue, setSearchValue] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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
                  {actionData?.error && (
                    <Text tone="critical">{actionData.error}</Text>
                  )}
                  <Button 
                    variant="primary" 
                    onClick={() => {
                      submit({ actionType: "login", username: userInput, password: pwInput }, { method: "POST" });
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
    submit({ actionType: "logout" }, { method: "POST" });
  };

  const filteredShops = useMemo(() => {
    return shopStats.filter(shop => {
      const matchesSearch = shop.shop.toLowerCase().includes(appliedSearch.toLowerCase());
      const matchesStatus = statusFilter === "all" || 
        (statusFilter === "active" && shop.isActive) || 
        (statusFilter === "deactivated" && !shop.isActive);
      return matchesSearch && matchesStatus;
    });
  }, [shopStats, appliedSearch, statusFilter]);

  const handleToggleActive = (shopId) => {
    submit({ actionType: "toggle_active", shopId }, { method: "POST" });
  };

  const handleSearch = () => {
    setAppliedSearch(searchValue);
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
                  <InlineStack align="space-between">
                     <Text as="h2" variant="headingMd">Shop Search & Filters</Text>
                     <Button variant="plain" onClick={() => { setSearchValue(""); setAppliedSearch(""); setStatusFilter("all"); }}>Clear Filters</Button>
                  </InlineStack>
                  <InlineStack gap="300" align="start">
                    <div style={{ flexGrow: 1 }}>
                      <TextField
                        label="Search by Shop Domain"
                        labelHidden
                        placeholder="example.myshopify.com"
                        value={searchValue}
                        onChange={setSearchValue}
                        prefix={<Icon source={SearchIcon} />}
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ width: '200px' }}>
                      <Select
                        label="Status"
                        labelHidden
                        options={[
                          {label: 'All Statuses', value: 'all'},
                          {label: 'Active Only', value: 'active'},
                          {label: 'Deactivated Only', value: 'deactivated'},
                        ]}
                        onChange={setStatusFilter}
                        value={statusFilter}
                      />
                    </div>
                    <Button variant="primary" onClick={handleSearch}>Search</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card padding="0">
                <IndexTable
                  resourceName={{ singular: 'shop', plural: 'shops' }}
                  itemCount={filteredShops.length}
                  headings={[
                    { title: 'Shop Domain' },
                    { title: 'Usage Status' },
                    { title: 'Jobs' },
                    { title: 'Images' },
                    { title: 'Control Access' },
                    { title: 'Details' },
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
                          {shop.isActive ? "Enabled" : "Disabled"}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{shop.totalJobs}</IndexTable.Cell>
                      <IndexTable.Cell>{shop.totalImages}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button 
                          size="slim"
                          variant="primary"
                          tone={shop.isActive ? "critical" : "success"}
                          onClick={() => handleToggleActive(shop.id)}
                        >
                          {shop.isActive ? "Deactivate App" : "Activate App"}
                        </Button>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Link url={`/super-admin/shop/${shop.id}`}>
                          Logs & More
                        </Link>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
                {filteredShops.length === 0 && (
                  <Box padding="1000">
                    <BlockStack align="center" inlineAlign="center">
                       <Text tone="subdued">No shops found matching your criteria.</Text>
                    </BlockStack>
                  </Box>
                )}
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
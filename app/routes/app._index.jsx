import { useState, useCallback } from "react";
import { AppProvider, Page, Layout, Card, DropZone, BlockStack, Text, Button, IndexTable, Badge } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useSubmit, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import prisma from "../db.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Ask Prisma for all jobs for this specific store, sorted by newest first
  const jobs = await prisma.uploadJob.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: 'desc' },
  });

  return { jobs };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, accessToken } = session;

  // 1. Ask Shopify for the store owner's email
  const shopQuery = await admin.graphql(`
    #graphql
    query { shop { email } }
  `);
  const shopData = await shopQuery.json();
  const storeOwnerEmail = shopData.data.shop.email;

  // 2. CREATE THE DATABASE RECORD! (Status defaults to "Processing")
  const newJob = await prisma.uploadJob.create({
    data: { shop: shop },
  });

  const formData = await request.formData();
  const rawPayload = formData.get("payload");

  // 3. Open the package and add our keys, email, AND the new database Job ID
  const parsedPayload = JSON.parse(rawPayload);
  parsedPayload.shop = shop;
  parsedPayload.accessToken = accessToken;
  parsedPayload.email = storeOwnerEmail;
  parsedPayload.jobId = newJob.id; // Boom! We pass the ID to n8n.

  const finalPayload = JSON.stringify(parsedPayload);

  // 4. Send it to n8n
  const n8nUrl = "https://n8n.n8nexperts.org/webhook/fe1f8f1c-0983-42d0-b013-dc559b612735";

  try {
    await fetch(n8nUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: finalPayload
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export default function Index() {
  const { jobs } = useLoaderData();
  const [files, setFiles] = useState([]);

  const submit = useSubmit();
  const actionData = useActionData();

  const handleDropZoneDrop = useCallback(
    (_dropFiles, acceptedFiles, _rejectedFiles) =>
      setFiles((files) => [...files, ...acceptedFiles]),
    [],
  );

  const handleUpload = async () => {
    const filePromises = files.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            name: file.name,
            type: file.type,
            base64Data: reader.result
          });
        };
        reader.readAsDataURL(file);
      });
    });

    const base64Files = await Promise.all(filePromises);
    const payload = JSON.stringify({ Files: base64Files });

    submit({ payload }, { method: "POST" });
    setFiles([]);
  };

  return (
    // 3. We wrap our entire UI inside the AppProvider and feed it the English translations
    <AppProvider i18n={enTranslations}>
      <Page title="Batch Image Uploader">
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Upload Product Images</Text>

                  <DropZone onDrop={handleDropZoneDrop}>
                    {files.length === 0 && <DropZone.FileUpload />}
                    {files.length > 0 && (
                      <div style={{ padding: '16px' }}>
                        <Text>Ready to upload {files.length} files.</Text>
                      </div>
                    )}
                  </DropZone>

                  <Button
                    variant="primary"
                    onClick={handleUpload}
                    disabled={files.length === 0}
                  >
                    Upload Images
                  </Button>

                  {actionData?.success && (
                    <Text tone="success">Images successfully sent to n8n for processing!</Text>
                  )}
                </BlockStack>
              </Card>
              <Layout.Section>
                <Card padding="0">
                  <IndexTable
                    resourceName={{ singular: 'upload job', plural: 'upload jobs' }}
                    itemCount={jobs.length}
                    headings={[
                      { title: 'Job ID' },
                      { title: 'Started' },
                      { title: 'Finished' },
                      { title: 'Duration' },
                      { title: 'Status' },
                    ]}
                    selectable={false}
                  >
                    {jobs.map((job) => {
                      // 1. Calculate the duration in seconds
                      const durationInSeconds = job.completedAt
                        ? Math.floor((new Date(job.completedAt) - new Date(job.createdAt)) / 1000)
                        : null;

                      return (
                        <IndexTable.Row key={job.id} id={job.id} position={job.id}>
                          <IndexTable.Cell>
                            <Text variant="bodyMd" fontWeight="bold" as="span">#{job.id}</Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {new Date(job.createdAt).toLocaleTimeString()}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : "—"}
                          </IndexTable.Cell>

                          {/* 2. Display the Duration dynamically */}
                          <IndexTable.Cell>
                            {durationInSeconds !== null
                              ? `${durationInSeconds}s`
                              : <Text tone="subdued">Calculated on finish</Text>
                            }
                          </IndexTable.Cell>

                          <IndexTable.Cell>
                            <Badge tone={job.status === "Complete" ? "success" : "info"}>
                              {job.status}
                            </Badge>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>
                </Card>
              </Layout.Section>
            </Layout.Section>
          </Layout>
          <div style={{ height: '60px' }} />
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
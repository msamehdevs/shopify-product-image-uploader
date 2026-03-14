import { useState, useCallback } from "react";
import { AppProvider, Page, Layout, Card, DropZone, BlockStack, Text, Button, IndexTable, Badge } from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useSubmit, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import db from "../db.server"; 

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  
  const timeoutLimit = new Date(Date.now() - 15 * 60 * 1000);
  
  await db.uploadJob.updateMany({
    where: {
      status: "PROCESSING",
      createdAt: { lt: timeoutLimit },
      shop: session.shop
    },
    data: { status: "FAILED" }
  });

  // 2. FETCH UPDATED JOBS
  const jobs = await db.uploadJob.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  return { jobs };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, accessToken } = session;

  const formData = await request.formData();
  const actionType = formData.get("actionType") || "upload";

  if (actionType === "delete_all_jobs") {
    await db.uploadJob.deleteMany({
      where: { shop: session.shop },
    });
    return { success: true, message: "All jobs deleted" };
  }

  if (actionType === "delete_job") {
    const jobId = formData.get("jobId");
    await db.uploadJob.delete({
      where: { id: parseInt(jobId), shop: session.shop },
    });
    return { success: true, message: `Job #${jobId} deleted` };
  }

  // Default: Upload action
  const shopQuery = await admin.graphql(`
    #graphql
    query { shop { email } }
  `);
  const shopData = await shopQuery.json();
  const storeOwnerEmail = shopData.data.shop.email;

  const newJob = await db.uploadJob.create({
    data: { shop: shop },
  });

  const rawPayload = formData.get("payload");
  const parsedPayload = JSON.parse(rawPayload);
  parsedPayload.shop = shop;
  parsedPayload.accessToken = accessToken;
  parsedPayload.email = storeOwnerEmail;
  parsedPayload.jobId = newJob.id; 

  const finalPayload = JSON.stringify(parsedPayload);
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

    submit({ payload, actionType: "upload" }, { method: "POST" });
    setFiles([]);
  };

  const handleDeleteAll = () => {
    if (confirm("Are you sure you want to delete all job history?")) {
      submit({ actionType: "delete_all_jobs" }, { method: "POST" });
    }
  };

  const handleDeleteJob = (jobId) => {
    if (confirm(`Are you sure you want to delete job #${jobId}?`)) {
      submit({ actionType: "delete_job", jobId }, { method: "POST" });
    }
  };

  return (
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
                  {actionData?.success && actionData?.message && (
                    <div style={{ marginTop: '8px' }}>
                      <Text tone="success">{actionData.message}</Text>
                    </div>
                  )}
                  {actionData?.success && !actionData?.message && (
                    <div style={{ marginTop: '8px' }}>
                      <Text tone="success">Images successfully sent for processing!</Text>
                    </div>
                  )}
                </BlockStack>
              </Card>
              <Layout.Section>
                <Card padding="0">
                  <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text variant="headingMd" as="h2">Execution History</Text>
                    <Button 
                      tone="critical" 
                      variant="tertiary" 
                      onClick={handleDeleteAll}
                      disabled={jobs.length === 0}
                    >
                      Delete All History
                    </Button>
                  </div>
                  <IndexTable
                    resourceName={{ singular: 'upload job', plural: 'upload jobs' }}
                    itemCount={jobs.length}
                    headings={[
                      { title: 'Job ID' },
                      { title: 'Started' },
                      { title: 'Finished' },
                      { title: 'Duration' },
                      { title: 'Status' },
                      { title: 'Actions' },
                    ]}
                    selectable={false}
                  >
                    {jobs.map((job) => {
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
                          <IndexTable.Cell>
                            {durationInSeconds !== null
                              ? `${durationInSeconds}s`
                              : <Text tone="subdued">Calculated on finish</Text>
                            }
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={job.status === "COMPLETED" ? "success" : job.status === "FAILED" ? "critical" : "info"}>
                              {job.status}
                            </Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Button
                              icon={DeleteIcon}
                              tone="critical"
                              variant="tertiary"
                              onClick={() => handleDeleteJob(job.id)}
                              accessibilityLabel={`Delete job ${job.id}`}
                            />
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
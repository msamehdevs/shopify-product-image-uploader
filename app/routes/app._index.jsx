import { useState, useCallback, useMemo } from "react";
import { AppProvider, Page, Layout, Card, DropZone, BlockStack, Text, Button, IndexTable, Badge, Pagination, Select, InlineStack } from "@shopify/polaris";
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

  // 1. FETCH UPDATED JOBS
  const jobs = await db.uploadJob.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  // 2. FETCH DASHBOARD STATS
  const response = await admin.graphql(
    `#graphql
    query getProductStats {
      productsCount {
        count
      }
      products(first: 50) {
        nodes {
          id
          title
          images(first: 20) {
            nodes {
              url
              altText
            }
          }
        }
      }
    }`
  );
  
  const responseJson = await response.json();
  const productCount = responseJson.data.productsCount.count;
  const products = responseJson.data.products.nodes;
  
  // Calculate total images across fetched products
  let totalImagesCount = 0;
  const productList = [];
  
  products.forEach(product => {
    const images = product.images.nodes;
    totalImagesCount += images.length;
    
    if (images.length === 0) {
      productList.push({
        id: `${product.id}-no-img`,
        title: product.title,
        imageName: "No images"
      });
    } else {
      images.forEach((img, idx) => {
        // Extract filename from URL
        const urlParts = img.url.split('/');
        const fileName = urlParts[urlParts.length - 1].split('?')[0];
        productList.push({
          id: `${product.id}-${idx}`,
          title: idx === 0 ? product.title : "", // Only show title for the first image of a product
          imageName: fileName
        });
      });
    }
  });

  return { jobs, productCount, totalImagesCount, productList };
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
  const { jobs, productCount, totalImagesCount, productList } = useLoaderData();
  const [files, setFiles] = useState([]);
  const submit = useSubmit();
  const actionData = useActionData();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState('5');

  const handleItemsPerPageChange = useCallback((value) => {
    setItemsPerPage(value);
    setCurrentPage(1);
  }, []);

  const pagedProductList = useMemo(() => {
    const start = (currentPage - 1) * parseInt(itemsPerPage);
    const end = start + parseInt(itemsPerPage);
    return productList.slice(start, end);
  }, [productList, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(productList.length / parseInt(itemsPerPage));

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

  const handleExportCSV = () => {
    const headers = ["Product Title", "Image Filename"];
    const rows = productList.map(p => [`"${p.title.replace(/"/g, '""')}"`, `"${p.imageName.replace(/"/g, '""')}"`]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(r => r.join(","))
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "products_images_report.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          {/* Dashboard Stats */}
          <Layout>
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h6" tone="subdued">Total Products</Text>
                  <Text variant="headingLg" as="p">{productCount}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h6" tone="subdued">Total Images (Found)</Text>
                  <Text variant="headingLg" as="p">{totalImagesCount}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

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
            </Layout.Section>

            {/* Products and Images Table */}
            <Layout.Section>
              <Card padding="0">
                <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="headingMd" as="h2">Products and Images</Text>
                  <Button variant="secondary" onClick={handleExportCSV}>
                    Export CSV (Excel)
                  </Button>
                </div>
                <IndexTable
                  resourceName={{ singular: 'product', plural: 'products' }}
                  itemCount={pagedProductList.length}
                  headings={[
                    { title: 'Product Title' },
                    { title: 'Image Filename' },
                  ]}
                  selectable={false}
                >
                  {pagedProductList.map((product, index) => (
                    <IndexTable.Row key={product.id} id={product.id} position={index}>
                      <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="bold" as="span">{product.title}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodyMd" as="span" tone="subdued">
                          {product.imageName}
                        </Text>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
                <div style={{ padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                  <InlineStack align="space-between">
                    <div style={{ width: '150px' }}>
                      <Select
                        label="Items per page"
                        labelHidden
                        options={[
                          {label: '5 items', value: '5'},
                          {label: '10 items', value: '10'},
                          {label: '25 items', value: '25'},
                        ]}
                        onChange={handleItemsPerPageChange}
                        value={itemsPerPage}
                      />
                    </div>
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => setCurrentPage((page) => page - 1)}
                      hasNext={currentPage < totalPages}
                      onNext={() => setCurrentPage((page) => page + 1)}
                    />
                  </InlineStack>
                </div>
              </Card>
            </Layout.Section>

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
                          <Badge tone={
                            job.status === "COMPLETED" ? "success" : 
                            job.status === "FAILED" ? "critical" : 
                            job.status === "PROCESSING" ? "attention" : "info"
                          }>
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
          </Layout>
          <div style={{ height: '60px' }} />
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
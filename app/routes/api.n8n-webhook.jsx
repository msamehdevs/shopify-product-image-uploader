import prisma from "../db.server";

export const action = async ({ request }) => {
  // 1. Only accept POST requests from n8n
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 2. Open the payload n8n sent us
    const payload = await request.json();
    const { jobId } = payload;

    if (!jobId) {
      return new Response(JSON.stringify({ error: "Missing jobId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Find that specific Job ID in Prisma and flip it to Complete!
    const updatedJob = await prisma.uploadJob.update({
      where: { id: parseInt(jobId) },
      data: { 
        status: (payload.status || "COMPLETED").toUpperCase(),
        completedAt: new Date() // Sets the 'now' timestamp
      },
    });

    return new Response(JSON.stringify({ success: true, job: updatedJob }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
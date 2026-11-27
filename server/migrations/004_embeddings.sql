-- B4: store an embedding (a 1024-number "meaning" vector) for each application,
-- so we can find similar jobs and, in B5, answer questions about them (RAG).

-- pgvector adds the `vector` type and distance operators to Postgres.
-- Neon has it built in (the SPEC's reason for choosing Neon), and CI uses the pgvector image.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE applications
  ADD COLUMN embedding vector(1024),       -- voyage-4-lite's default size
  ADD COLUMN embedded_at timestamptz,
  ADD COLUMN embedding_model text;         -- vectors from different models can't be compared

-- HNSW index for cosine distance (<=>): fast nearest-neighbour search as the table grows.
CREATE INDEX applications_embedding_idx ON applications USING hnsw (embedding vector_cosine_ops);

#!/usr/bin/env Rscript

# Fetch publications and citation counts from Google Scholar via the scholar package.
# Intended to run weekly in GitHub Actions; output is committed as static JSON.

args <- commandArgs(trailingOnly = TRUE)
scholar_id <- if (length(args) >= 1) args[[1]] else Sys.getenv("SCHOLAR_ID", "LyaJ880AAAAJ")
output_path <- if (length(args) >= 2) args[[2]] else "data/publications.json"

if (!nzchar(scholar_id)) {
  stop("Google Scholar ID is required.")
}

if (!requireNamespace("scholar", quietly = TRUE) || !requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Required packages 'scholar' and 'jsonlite' must be installed before running this script.")
}

library(scholar)
library(jsonlite)

message("Fetching Google Scholar profile: ", scholar_id)
Sys.sleep(2)

profile <- get_profile(scholar_id)
Sys.sleep(2)

message("Fetching publications...")
publications <- get_publications(scholar_id, flush = TRUE)

papers <- lapply(seq_len(nrow(publications)), function(i) {
  row <- publications[i, , drop = FALSE]
  list(
    title = as.character(row$title),
    authors = as.character(row$author),
    journal = as.character(row$journal),
    year = suppressWarnings(as.integer(row$year)),
    citations = suppressWarnings(as.integer(row$cites)),
    cid = as.character(row$cid),
    pubid = as.character(row$pubid)
  )
})

payload <- list(
  last_updated = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  scholar_id = scholar_id,
  profile = list(
    name = as.character(profile$name),
    affiliation = as.character(profile$affiliation),
    total_citations = as.integer(profile$total_cites),
    h_index = as.integer(profile$h_index),
    i10_index = as.integer(profile$i10_index)
  ),
  papers = papers
)

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)

write_json(
  payload,
  output_path,
  pretty = TRUE,
  auto_unbox = TRUE,
  na = "null"
)

message("Wrote ", nrow(publications), " publications to ", output_path)

-- Migration: 2026101000040000_reset_is_symmetric_flag.sql
-- Reset toan bo co is_symmetric ve false tren image_library

UPDATE public.image_library
SET is_symmetric = false
WHERE is_symmetric = true;


REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

CREATE POLICY "own uploads read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'baby-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own uploads insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'baby-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own uploads delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'baby-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

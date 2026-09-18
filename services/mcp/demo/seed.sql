-- MXGenius complete demonstration dataset.
-- Loaded only by the authenticated administrator endpoint. All records are
-- fictional, visibly labeled, and scoped to the caller's organization.

DO $$
DECLARE
    demo_org uuid := current_setting('mxgenius.demo_org')::uuid;
    demo_actor uuid := current_setting('mxgenius.demo_actor')::uuid;
BEGIN
    INSERT INTO aircraft_canonical (
        id, organization_id, aircraft_id, source_system, source_id, make, model,
        year, registration, serial_number, base_icao, base_iata, base_city,
        base_country, metadata, source_hash, freshness_at, updated_at
    ) VALUES (
        'd0000000-0000-4000-8000-000000000001', demo_org, 'MXG-DEMO-N350MX',
        'demo', 'demo-aircraft-1', 'Bombardier', 'Challenger 350', 2022,
        'N350MX', 'DEMO-350-001', 'KDAL', 'DAL', 'Dallas', 'US',
        jsonb_build_object(
            'dataset', 'mxgenius_complete_demo', 'demo', true,
            'label', 'DEMO AIRCRAFT — NOT A REAL REGISTRATION',
            'airframe_hours', 1842.6, 'airframe_cycles', 1297,
            'owner', 'MXG Demo Aviation LLC', 'operator', 'MXG Demo Flight Department'
        ),
        'demo-aircraft-source-hash', now(), now()
    ) ON CONFLICT (organization_id, aircraft_id) DO UPDATE SET
        metadata=EXCLUDED.metadata, freshness_at=EXCLUDED.freshness_at,
        updated_at=EXCLUDED.updated_at;

    INSERT INTO maintenance_cases (
        case_id, organization_id, aircraft_id, status, priority, opened_at,
        updated_at, location, raw_discrepancy, normalized_discrepancy,
        assigned_user_ids, evidence_ids, approval_state, version
    ) VALUES
    (
        'd0000000-0000-4000-8000-000000000101', demo_org, 'd0000000-0000-4000-8000-000000000001',
        'diagnosing', 'urgent', now() - interval '45 minutes', now() - interval '5 minutes',
        '{"icao":"KDAL","facility":"Demo Hangar 2"}'::jsonb,
        '[DEMO] Left wingtip strobe light is intermittent; lens shows a hairline crack and internal moisture.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"demo_suite":"friday_funding_demo","demo_sequence":1,"summary":"ATA 33 left wingtip strobe light replacement","raw":"[DEMO] Left wingtip strobe light is intermittent; lens shows a hairline crack and internal moisture.","ata":"33","symptom":"intermittent strobe with cracked lens","component_id":"MXG-DEMO-STROBE-LH"}'::jsonb,
        ARRAY[demo_actor],
        ARRAY['d0000000-0000-4000-8000-000000000501'::uuid,'d0000000-0000-4000-8000-000000000502'::uuid],
        'pending', 3
    ),
    (
        'd0000000-0000-4000-8000-000000000102', demo_org, 'd0000000-0000-4000-8000-000000000001',
        'awaiting_parts', 'aog', now() - interval '3 hours', now() - interval '12 minutes',
        '{"icao":"KDAL","facility":"Demo Hangar 2"}'::jsonb,
        '[DEMO] Right main tire has exposed cord and the brake stack is near wear limit; wheel replacement required.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"demo_suite":"friday_funding_demo","demo_sequence":2,"summary":"ATA 32 right main wheel tire and brake replacement","raw":"[DEMO] Right main tire has exposed cord and the brake stack is near wear limit; wheel replacement required.","ata":"32","symptom":"tire cord exposed and brake wear near limit","component_id":"MXG-DEMO-MAIN-WHEEL-RH"}'::jsonb,
        ARRAY[demo_actor], ARRAY['d0000000-0000-4000-8000-000000000503'::uuid],
        'pending', 4
    ),
    (
        'd0000000-0000-4000-8000-000000000103', demo_org, 'd0000000-0000-4000-8000-000000000001',
        'awaiting_inspection', 'urgent', now() - interval '90 minutes', now() - interval '18 minutes',
        '{"icao":"KDAL","facility":"Demo Hangar 1"}'::jsonb,
        '[DEMO] Left windshield has a localized outer-ply impact mark; damage limits require remote qualified review.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"demo_suite":"friday_funding_demo","demo_sequence":3,"summary":"ATA 56 left windshield damage-limit review","raw":"[DEMO] Left windshield has a localized outer-ply impact mark; damage limits require remote qualified review.","ata":"56","symptom":"localized outer-ply impact mark","component_id":"MXG-DEMO-WINDSHIELD-LH","remote_witness_ready":true}'::jsonb,
        ARRAY[demo_actor], ARRAY['d0000000-0000-4000-8000-000000000504'::uuid],
        'pending', 2
    ),
    (
        'd0000000-0000-4000-8000-000000000104', demo_org, 'd0000000-0000-4000-8000-000000000001',
        'closed', 'routine', now() - interval '120 days', now() - interval '119 days 20 hours',
        '{"icao":"KDAL","facility":"Demo Hangar 1"}'::jsonb,
        '[DEMO] Archived hydraulic pressure example.',
        '{"dataset":"mxgenius_complete_demo","demo":true,"presentation_hidden":true,"summary":"Archived ATA 29 hydraulic example","raw":"[DEMO] Archived hydraulic pressure example.","ata":"29","symptom":"archived demo record","component_id":"MXG-DEMO-HYD-PUMP-B","resolution":"serviced reservoir"}'::jsonb,
        ARRAY[demo_actor], ARRAY[]::uuid[], 'approved', 4
    )
    ON CONFLICT (case_id) DO UPDATE SET
        aircraft_id=EXCLUDED.aircraft_id, status=EXCLUDED.status, priority=EXCLUDED.priority,
        opened_at=EXCLUDED.opened_at, updated_at=EXCLUDED.updated_at, location=EXCLUDED.location,
        raw_discrepancy=EXCLUDED.raw_discrepancy,
        normalized_discrepancy=EXCLUDED.normalized_discrepancy,
        assigned_user_ids=EXCLUDED.assigned_user_ids,
        evidence_ids=EXCLUDED.evidence_ids,
        approval_state=EXCLUDED.approval_state, version=EXCLUDED.version;

    INSERT INTO discrepancies (id, organization_id, case_id, normalized_summary, raw) VALUES
        ('d0000000-0000-4000-8000-000000000201', demo_org, 'd0000000-0000-4000-8000-000000000101', 'ATA 33 left wingtip strobe light replacement', '[DEMO] Left wingtip strobe light is intermittent; lens shows a hairline crack and internal moisture.'),
        ('d0000000-0000-4000-8000-000000000202', demo_org, 'd0000000-0000-4000-8000-000000000102', 'ATA 32 right main wheel tire and brake replacement', '[DEMO] Right main tire has exposed cord and the brake stack is near wear limit; wheel replacement required.'),
        ('d0000000-0000-4000-8000-000000000203', demo_org, 'd0000000-0000-4000-8000-000000000103', 'ATA 56 left windshield damage-limit review', '[DEMO] Left windshield has a localized outer-ply impact mark; damage limits require remote qualified review.')
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        normalized_summary=EXCLUDED.normalized_summary, raw=EXCLUDED.raw;

    INSERT INTO maintenance_events (id, organization_id, case_id, from_status, to_status, actor_user_id, reason, created_at) VALUES
        ('d0000000-0000-4000-8000-000000000211', demo_org, 'd0000000-0000-4000-8000-000000000101', 'open', 'diagnosing', demo_actor, '[DEMO] Strobe lens damage confirmed; replacement path opened.', now() - interval '30 minutes'),
        ('d0000000-0000-4000-8000-000000000212', demo_org, 'd0000000-0000-4000-8000-000000000102', 'diagnosing', 'awaiting_parts', demo_actor, '[DEMO] Wheel, tire, brake, and hardware requirements linked to on-hand inventory.', now() - interval '2 hours'),
        ('d0000000-0000-4000-8000-000000000213', demo_org, 'd0000000-0000-4000-8000-000000000103', 'diagnosing', 'awaiting_inspection', demo_actor, '[DEMO] Windshield evidence captured and remote qualified review requested.', now() - interval '45 minutes')
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        from_status=EXCLUDED.from_status, to_status=EXCLUDED.to_status,
        reason=EXCLUDED.reason, created_at=EXCLUDED.created_at;

    INSERT INTO observations (id, organization_id, case_id, note, component_id, author_user_id, media_refs, created_at) VALUES
        ('d0000000-0000-4000-8000-000000000221', demo_org, 'd0000000-0000-4000-8000-000000000101', '[DEMO] Strobe operated intermittently during functional check; lens crack and internal moisture are visible.', 'MXG-DEMO-STROBE-LH', demo_actor, '[{"kind":"demo_photo","label":"Left wingtip strobe inspection","url":"media/demo/maintenance-strobe-light.png"}]'::jsonb, now() - interval '25 minutes'),
        ('d0000000-0000-4000-8000-000000000222', demo_org, 'd0000000-0000-4000-8000-000000000102', '[DEMO] Right main tire cord is exposed and brake wear is near the demonstration limit.', 'MXG-DEMO-MAIN-WHEEL-RH', demo_actor, '[{"kind":"demo_photo","label":"Right main wheel and brake inspection","url":"media/demo/maintenance-wheel-brake.jpg"}]'::jsonb, now() - interval '2 hours'),
        ('d0000000-0000-4000-8000-000000000223', demo_org, 'd0000000-0000-4000-8000-000000000103', '[DEMO] Localized outer-ply impact mark photographed for remote damage-limit review.', 'MXG-DEMO-WINDSHIELD-LH', demo_actor, '[{"kind":"demo_photo","label":"Left windshield impact mark","url":"media/demo/maintenance-windshield-damage.png"}]'::jsonb, now() - interval '40 minutes')
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        note=EXCLUDED.note, component_id=EXCLUDED.component_id,
        media_refs=EXCLUDED.media_refs, created_at=EXCLUDED.created_at;

    INSERT INTO case_assignments (organization_id, case_id, user_id) VALUES
        (demo_org, 'd0000000-0000-4000-8000-000000000101', demo_actor),
        (demo_org, 'd0000000-0000-4000-8000-000000000102', demo_actor),
        (demo_org, 'd0000000-0000-4000-8000-000000000103', demo_actor)
    ON CONFLICT DO NOTHING;

    INSERT INTO components (id, aircraft_id, ata, name, metadata) VALUES
        ('d0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000001', '33', 'Left Wingtip Strobe Light', '{"dataset":"mxgenius_complete_demo","demo":true,"component_id":"MXG-DEMO-STROBE-LH","zone":"left_wingtip","status":"replace"}'::jsonb),
        ('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000001', '32', 'Right Main Wheel and Brake', '{"dataset":"mxgenius_complete_demo","demo":true,"component_id":"MXG-DEMO-MAIN-WHEEL-RH","zone":"right_main_landing_gear","status":"aog"}'::jsonb),
        ('d0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000001', '56', 'Left Cockpit Windshield', '{"dataset":"mxgenius_complete_demo","demo":true,"component_id":"MXG-DEMO-WINDSHIELD-LH","zone":"cockpit_left_windshield","status":"remote_review"}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET
        aircraft_id=EXCLUDED.aircraft_id, ata=EXCLUDED.ata,
        name=EXCLUDED.name, metadata=EXCLUDED.metadata;

    INSERT INTO technical_documents (id, organization_id, title, doc_type) VALUES
        ('d0000000-0000-4000-8000-000000000401', demo_org, '[DEMO] Challenger 350 Exterior Lighting Work Card', 'maintenance_manual'),
        ('d0000000-0000-4000-8000-000000000402', demo_org, '[DEMO] Challenger 350 Main Wheel and Brake Work Card', 'maintenance_manual'),
        ('d0000000-0000-4000-8000-000000000403', demo_org, '[DEMO] Challenger 350 Windshield Damage Review Card', 'maintenance_manual'),
        ('d0000000-0000-4000-8000-000000000404', demo_org, '[DEMO] Parts Receiving and Traceability Procedure', 'company_procedure')
    ON CONFLICT (organization_id, id) DO UPDATE SET title=EXCLUDED.title, doc_type=EXCLUDED.doc_type;

    INSERT INTO document_revisions (id, document_id, revision, effective_date, uploaded_by, sha256) VALUES
        ('d0000000-0000-4000-8000-000000000411', 'd0000000-0000-4000-8000-000000000401', 'DEMO-1', current_date - 30, demo_actor, repeat('a',64)),
        ('d0000000-0000-4000-8000-000000000412', 'd0000000-0000-4000-8000-000000000402', 'DEMO-2', current_date - 30, demo_actor, repeat('b',64)),
        ('d0000000-0000-4000-8000-000000000413', 'd0000000-0000-4000-8000-000000000403', 'DEMO-1', current_date - 30, demo_actor, repeat('c',64)),
        ('d0000000-0000-4000-8000-000000000414', 'd0000000-0000-4000-8000-000000000404', 'DEMO-2', current_date - 15, demo_actor, repeat('d',64))
    ON CONFLICT (document_id, revision) DO UPDATE SET effective_date=EXCLUDED.effective_date, sha256=EXCLUDED.sha256;

    INSERT INTO regulatory_requirements (id, source_reference, document_id, summary) VALUES
        ('d0000000-0000-4000-8000-000000000421', 'demo://operator/windshield-limit-review', 'd0000000-0000-4000-8000-000000000403', '[DEMO ONLY] A qualified reviewer must disposition the fictional windshield damage before release.')
    ON CONFLICT (id) DO UPDATE SET source_reference=EXCLUDED.source_reference,
        document_id=EXCLUDED.document_id, summary=EXCLUDED.summary;

    DELETE FROM case_regulatory_links
    WHERE requirement_id='d0000000-0000-4000-8000-000000000421';

    INSERT INTO case_regulatory_links (case_id, requirement_id) VALUES
        ('d0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-000000000421')
    ON CONFLICT DO NOTHING;

    INSERT INTO evidence (
        id, organization_id, source_type, source_reference, kind, title, excerpt,
        retrieved_at, effective_at, revision, license_scope, content_hash, content
    ) VALUES
        ('d0000000-0000-4000-8000-000000000501', demo_org, 'demo', 'demo://manual/strobe/33', 'manual_excerpt', '[DEMO] Strobe Light Replacement Work Card', 'Demonstration flow: isolate power, remove the damaged strobe assembly, install the matched serviceable unit, and perform the lighting operational check.', now() - interval '20 minutes', now() - interval '30 days', 'DEMO-1', 'fictional-demo-only', repeat('1',64), 'Fictional demonstration content. Use current approved maintenance data for real work.'),
        ('d0000000-0000-4000-8000-000000000502', demo_org, 'demo', 'demo://inspection/strobe-photo', 'inspection_observation', '[DEMO] Left Wingtip Strobe Inspection', 'Inspection image shows a hairline lens crack and internal moisture.', now() - interval '18 minutes', now() - interval '18 minutes', '1', 'fictional-demo-only', repeat('2',64), 'Fictional demonstration inspection record.'),
        ('d0000000-0000-4000-8000-000000000503', demo_org, 'demo', 'demo://manual/wheel/32', 'manual_excerpt', '[DEMO] Main Wheel and Brake Work Card', 'Demonstration flow connects the wheel case to matched synthetic inventory, trace records, and approved-manual retrieval for removal, installation, torque, and inspection steps.', now() - interval '90 minutes', now() - interval '30 days', 'DEMO-1', 'fictional-demo-only', repeat('3',64), 'Fictional demonstration content. No torque value in this record is approved maintenance data.'),
        ('d0000000-0000-4000-8000-000000000504', demo_org, 'demo', 'demo://inspection/windshield-photo', 'inspection_observation', '[DEMO] Windshield Damage Remote Review', 'Localized outer-ply impact evidence is ready for a remote qualified reviewer to compare with current approved limits and record a disposition.', now() - interval '35 minutes', now() - interval '35 minutes', '1', 'fictional-demo-only', repeat('4',64), 'Fictional demonstration inspection record. Human qualified review remains required.')
    ON CONFLICT (organization_id, content_hash) DO UPDATE SET
        source_type=EXCLUDED.source_type, source_reference=EXCLUDED.source_reference,
        kind=EXCLUDED.kind, title=EXCLUDED.title, excerpt=EXCLUDED.excerpt,
        retrieved_at=EXCLUDED.retrieved_at, effective_at=EXCLUDED.effective_at,
        revision=EXCLUDED.revision, license_scope=EXCLUDED.license_scope,
        content=EXCLUDED.content;

    UPDATE evidence_links
    SET aircraft_id='d0000000-0000-4000-8000-000000000001'
    WHERE organization_id=demo_org
      AND aircraft_id='MXG-DEMO-N350MX'
      AND case_id IN (
          'd0000000-0000-4000-8000-000000000101',
          'd0000000-0000-4000-8000-000000000102',
          'd0000000-0000-4000-8000-000000000103'
      );

    DELETE FROM evidence_links
    WHERE organization_id=demo_org
      AND evidence_id IN (
          'd0000000-0000-4000-8000-000000000501',
          'd0000000-0000-4000-8000-000000000502',
          'd0000000-0000-4000-8000-000000000503',
          'd0000000-0000-4000-8000-000000000504'
      );

    INSERT INTO evidence_links (organization_id, evidence_id, case_id, aircraft_id, document_id) VALUES
        (demo_org, 'd0000000-0000-4000-8000-000000000501', 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000401'),
        (demo_org, 'd0000000-0000-4000-8000-000000000502', 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000001', NULL),
        (demo_org, 'd0000000-0000-4000-8000-000000000503', 'd0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000402'),
        (demo_org, 'd0000000-0000-4000-8000-000000000504', 'd0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000403')
    ON CONFLICT DO NOTHING;

    INSERT INTO approvals (id, organization_id, case_id, action, required_role, granted_by, granted_at, decision) VALUES
        ('d0000000-0000-4000-8000-000000000521', demo_org, 'd0000000-0000-4000-8000-000000000103', 'windshield_damage_limit_review', 'quality', NULL, NULL, NULL),
        ('d0000000-0000-4000-8000-000000000522', demo_org, 'd0000000-0000-4000-8000-000000000102', 'parts_release', 'quality', NULL, NULL, NULL)
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        action=EXCLUDED.action, required_role=EXCLUDED.required_role,
        granted_by=EXCLUDED.granted_by, granted_at=EXCLUDED.granted_at,
        decision=EXCLUDED.decision;

    INSERT INTO parts (id, part_number, description, manufacturer, canonical, classification, is_serialized, metadata, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000601', 'MXG-DEMO-29-1001', '[DEMO] Hydraulic pump assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000602', 'MXG-DEMO-21-2200', '[DEMO] Cabin air filter element', 'MXG Demo Components', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"21"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000603', 'MXG-DEMO-MS-O-RING', '[DEMO] Hydraulic fitting O-ring', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29"}'::jsonb, now())
    ON CONFLICT (part_number, manufacturer) DO UPDATE SET
        description=EXCLUDED.description, classification=EXCLUDED.classification,
        is_serialized=EXCLUDED.is_serialized, metadata=EXCLUDED.metadata, updated_at=now();

    -- Challenger 350 wheel and brake hardware for the demo scenario, plus a
    -- realistic spread across other ATA chapters. Part numbers are
    -- deliberately synthetic so none can be mistaken for real OEM data.
    INSERT INTO parts (id, part_number, description, manufacturer, canonical, classification, is_serialized, metadata, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000701', 'MXG-DEMO-32-1101', '[DEMO] Main wheel assembly, outboard half', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000702', 'MXG-DEMO-32-1102', '[DEMO] Main wheel assembly, inboard half', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000703', 'MXG-DEMO-32-1103', '[DEMO] Nose wheel assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000704', 'MXG-DEMO-32-1201', '[DEMO] Main brake assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000705', 'MXG-DEMO-32-1202', '[DEMO] Brake lining set, main', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000706', 'MXG-DEMO-32-1203', '[DEMO] Brake rotor disc', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000707', 'MXG-DEMO-32-1204', '[DEMO] Brake stator disc', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000708', 'MXG-DEMO-32-1205', '[DEMO] Brake pressure plate', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000709', 'MXG-DEMO-32-1301', '[DEMO] Main tire, radial', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000710', 'MXG-DEMO-32-1302', '[DEMO] Nose tire, radial', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000711', 'MXG-DEMO-32-1401', '[DEMO] Wheel bearing cone, inboard', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000712', 'MXG-DEMO-32-1402', '[DEMO] Wheel bearing cone, outboard', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000713', 'MXG-DEMO-32-1403', '[DEMO] Wheel bearing cup', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000714', 'MXG-DEMO-32-1404', '[DEMO] Grease seal, wheel hub', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000715', 'MXG-DEMO-32-1501', '[DEMO] Wheel tie bolt', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000716', 'MXG-DEMO-32-1502', '[DEMO] Wheel tie bolt nut', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000717', 'MXG-DEMO-32-1503', '[DEMO] Axle nut, main gear', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000718', 'MXG-DEMO-32-1504', '[DEMO] Cotter pin, axle nut', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000719', 'MXG-DEMO-32-1601', '[DEMO] Thermal fuse plug', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000720', 'MXG-DEMO-32-1602', '[DEMO] Tire valve stem', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000721', 'MXG-DEMO-32-1603', '[DEMO] Tire valve core', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000722', 'MXG-DEMO-32-1701', '[DEMO] Wheel hub cap', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000723', 'MXG-DEMO-32-1702', '[DEMO] Torque plate, brake', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000724', 'MXG-DEMO-32-1801', '[DEMO] Shimmy damper assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000725', 'MXG-DEMO-32-1802', '[DEMO] Gear door seal', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000726', 'MXG-DEMO-32-1901', '[DEMO] Wheel speed transducer', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000727', 'MXG-DEMO-32-1902', '[DEMO] Anti-skid harness, main gear', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"32","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000731', 'MXG-DEMO-29-1002', '[DEMO] Hydraulic filter element, return', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000732', 'MXG-DEMO-29-1003', '[DEMO] Hydraulic reservoir sight glass', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"29","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000733', 'MXG-DEMO-24-3001', '[DEMO] Generator control unit', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"24","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000734', 'MXG-DEMO-27-4001', '[DEMO] Flight control cable turnbuckle', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"27","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000735', 'MXG-DEMO-33-5001', '[DEMO] Landing light assembly', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"33","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000736', 'MXG-DEMO-34-6001', '[DEMO] Pitot probe, captain side', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"34","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000737', 'MXG-DEMO-79-7001', '[DEMO] Engine oil filter element', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"79","aircraft_type":"Challenger 350"}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000738', 'MXG-DEMO-33-5101', '[DEMO] Left wingtip strobe light assembly', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"ata":"33","aircraft_type":"Challenger 350","demo_suite":"friday_funding_demo"}'::jsonb, now())
    ON CONFLICT (part_number, manufacturer) DO UPDATE SET
        description=EXCLUDED.description, classification=EXCLUDED.classification,
        is_serialized=EXCLUDED.is_serialized, metadata=EXCLUDED.metadata, updated_at=now();

    -- Expanded presentation inventory. These 47 deliberately synthetic parts
    -- are one-to-one with the visual roster in docs/design/demo-parts-catalog.md.
    -- Stable slugs live in metadata so the UI can resolve a unique local image
    -- without treating a filename or a generated visual as approved part data.
    INSERT INTO parts (id, part_number, description, manufacturer, canonical, classification, is_serialized, metadata, updated_at) VALUES
        ('d1000000-0000-4000-8000-000000000001', 'MXG-DEMO-LGT-1101', '[DEMO] Aurora Wingtip Navigation Module', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":1,"demo_category":"Lighting","demo_visual_key":"aurora-wingtip-nav-module"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000002', 'MXG-DEMO-LGT-1102', '[DEMO] Runway Caster Taxi Lamp', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":2,"demo_category":"Lighting","demo_visual_key":"runway-caster-taxi-lamp"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000003', 'MXG-DEMO-LGT-1103', '[DEMO] PulseCrest Beacon Head', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":3,"demo_category":"Lighting","demo_visual_key":"pulsecrest-beacon-head"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000004', 'MXG-DEMO-LGT-1104', '[DEMO] LumaRail Cabin Strip Kit', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":4,"demo_category":"Lighting","demo_visual_key":"lumarail-cabin-strip-kit"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000005', 'MXG-DEMO-WBR-2101', '[DEMO] AeroArc Nose Wheel Assembly', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":5,"demo_category":"Wheels & Brakes","demo_visual_key":"aeroarc-nose-wheel-assembly"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000006', 'MXG-DEMO-WBR-2102', '[DEMO] VectorTorque Main Wheel', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":6,"demo_category":"Wheels & Brakes","demo_visual_key":"vectortorque-main-wheel"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000007', 'MXG-DEMO-WBR-2103', '[DEMO] HeatWeave Brake Rotor', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":7,"demo_category":"Wheels & Brakes","demo_visual_key":"heatweave-brake-rotor"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000008', 'MXG-DEMO-WBR-2104', '[DEMO] ClampForce Brake Caliper', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":8,"demo_category":"Wheels & Brakes","demo_visual_key":"clampforce-brake-caliper"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000009', 'MXG-DEMO-WBR-2105', '[DEMO] WearCheck Indicator Pin Set', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":9,"demo_category":"Wheels & Brakes","demo_visual_key":"wearcheck-indicator-pin-set"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000010', 'MXG-DEMO-TIR-3101', '[DEMO] GlidePath Nose Tire', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":10,"demo_category":"Tires","demo_visual_key":"glidepath-nose-tire"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000011', 'MXG-DEMO-TIR-3102', '[DEMO] RampStride Main Tire', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":11,"demo_category":"Tires","demo_visual_key":"rampstride-main-tire"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000012', 'MXG-DEMO-TIR-3103', '[DEMO] FieldFlex Low-Pressure Tire', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":12,"demo_category":"Tires","demo_visual_key":"fieldflex-low-pressure-tire"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000013', 'MXG-DEMO-ELE-4101', '[DEMO] StartLink Power Contactor', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":13,"demo_category":"Electrical","demo_visual_key":"startlink-power-contactor"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000014', 'MXG-DEMO-ELE-4102', '[DEMO] ArcGuard 10A Breaker', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":14,"demo_category":"Electrical","demo_visual_key":"arcguard-breaker-10a"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000015', 'MXG-DEMO-ELE-4103', '[DEMO] PowerDock Battery Tray', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":15,"demo_category":"Electrical","demo_visual_key":"powerdock-battery-tray"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000016', 'MXG-DEMO-ELE-4104', '[DEMO] BondWeave Ground Strap', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":16,"demo_category":"Electrical","demo_visual_key":"bondweave-ground-strap"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000017', 'MXG-DEMO-AVN-5101', '[DEMO] NavCore Comm Control Panel', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":17,"demo_category":"Avionics","demo_visual_key":"navcore-comm-control-panel"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000018', 'MXG-DEMO-AVN-5102', '[DEMO] HorizonView Display Unit', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":18,"demo_category":"Avionics","demo_visual_key":"horizonview-display-unit"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000019', 'MXG-DEMO-AVN-5103', '[DEMO] SquawkLink Transponder Panel', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":19,"demo_category":"Avionics","demo_visual_key":"squawklink-transponder-panel"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000020', 'MXG-DEMO-AVN-5104', '[DEMO] FlightData Interface Unit', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":20,"demo_category":"Avionics","demo_visual_key":"flightdata-interface-unit"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000021', 'MXG-DEMO-AVN-5105', '[DEMO] CrewLink Audio Controller', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":21,"demo_category":"Avionics","demo_visual_key":"crewlink-audio-controller"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000022', 'MXG-DEMO-FIL-6101', '[DEMO] AirShield Intake Filter', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":22,"demo_category":"Filters","demo_visual_key":"airshield-intake-filter"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000023', 'MXG-DEMO-FIL-6102', '[DEMO] HydraPure Return Filter', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":23,"demo_category":"Filters","demo_visual_key":"hydrapure-return-filter"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000024', 'MXG-DEMO-FIL-6103', '[DEMO] CabinMesh Air Filter', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":24,"demo_category":"Filters","demo_visual_key":"cabinmesh-air-filter"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000025', 'MXG-DEMO-HYD-7101', '[DEMO] PressureRidge Hydraulic Pump', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":25,"demo_category":"Hydraulics","demo_visual_key":"pressuridge-hydraulic-pump"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000026', 'MXG-DEMO-HYD-7102', '[DEMO] FlexFlow Hose Assembly', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":26,"demo_category":"Hydraulics","demo_visual_key":"flexflow-hose-assembly"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000027', 'MXG-DEMO-HYD-7103', '[DEMO] FluidNest Reservoir', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":27,"demo_category":"Hydraulics","demo_visual_key":"fluidnest-reservoir"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000028', 'MXG-DEMO-HYD-7104', '[DEMO] ReliefPoint Pressure Valve', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":28,"demo_category":"Hydraulics","demo_visual_key":"reliefpoint-pressure-valve"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000029', 'MXG-DEMO-FCT-8101', '[DEMO] TrimDrive Tab Actuator', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":29,"demo_category":"Flight Controls","demo_visual_key":"trimdrive-tab-actuator"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000030', 'MXG-DEMO-FCT-8102', '[DEMO] RollPivot Aileron Bellcrank', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":30,"demo_category":"Flight Controls","demo_visual_key":"rollpivot-aileron-bellcrank"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000031', 'MXG-DEMO-FCT-8103', '[DEMO] RudderLine Cable Kit', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":31,"demo_category":"Flight Controls","demo_visual_key":"rudderline-cable-kit"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000032', 'MXG-DEMO-FCT-8104', '[DEMO] FlapTrack Drive Gearbox', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":32,"demo_category":"Flight Controls","demo_visual_key":"flaptrack-drive-gearbox"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000033', 'MXG-DEMO-CAB-9101', '[DEMO] SeatRail Locking Fitting', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":33,"demo_category":"Cabin","demo_visual_key":"seatrail-locking-fitting"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000034', 'MXG-DEMO-CAB-9102', '[DEMO] SwivelAir Vent Outlet', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":34,"demo_category":"Cabin","demo_visual_key":"swivelair-vent-outlet"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000035', 'MXG-DEMO-CAB-9103', '[DEMO] BinHold Latch Assembly', 'MXG Demo Components', true, 'repairable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":35,"demo_category":"Cabin","demo_visual_key":"binhold-latch-assembly"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000036', 'MXG-DEMO-CAB-9104', '[DEMO] DoorSoft Pressure Seal', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":36,"demo_category":"Cabin","demo_visual_key":"doorsoft-pressure-seal"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000037', 'MXG-DEMO-SNS-1011', '[DEMO] ThermoSpire Temperature Probe', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":37,"demo_category":"Sensors","demo_visual_key":"thermospire-temperature-probe"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000038', 'MXG-DEMO-SNS-1012', '[DEMO] AirStream Pitot-Static Probe', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":38,"demo_category":"Sensors","demo_visual_key":"airstream-pitot-static-probe"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000039', 'MXG-DEMO-SNS-1013', '[DEMO] FuelLevel Capacitive Sender', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":39,"demo_category":"Sensors","demo_visual_key":"fuellevel-capacitive-sender"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000040', 'MXG-DEMO-SNS-1014', '[DEMO] GearNear Proximity Sensor', 'MXG Demo Components', true, 'rotable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":40,"demo_category":"Sensors","demo_visual_key":"gearnear-proximity-sensor"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000041', 'MXG-DEMO-CON-1111', '[DEMO] LockWire Stainless Spool', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":41,"demo_category":"Fasteners & Consumables","demo_visual_key":"lockwire-stainless-spool"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000042', 'MXG-DEMO-CON-1112', '[DEMO] FlushSet Rivet Assortment', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":42,"demo_category":"Fasteners & Consumables","demo_visual_key":"flushset-rivet-assortment"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000043', 'MXG-DEMO-CON-1113', '[DEMO] CushionClamp Line Kit', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":43,"demo_category":"Fasteners & Consumables","demo_visual_key":"cushionclamp-line-kit"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000044', 'MXG-DEMO-CON-1114', '[DEMO] SealPack O-Ring Assortment', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":44,"demo_category":"Fasteners & Consumables","demo_visual_key":"sealpack-o-ring-assortment"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000045', 'MXG-DEMO-SAF-1211', '[DEMO] EvacGlow Exit Path Marker', 'MXG Demo Standard Parts', true, 'consumable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":45,"demo_category":"Safety","demo_visual_key":"evacglow-exit-path-marker"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000046', 'MXG-DEMO-SAF-1212', '[DEMO] CrewSecure Four-Point Restraint', 'MXG Demo Components', true, 'repairable', true, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":46,"demo_category":"Safety","demo_visual_key":"crewsecure-four-point-restraint"}'::jsonb, now()),
        ('d1000000-0000-4000-8000-000000000047', 'MXG-DEMO-SAF-1213', '[DEMO] QuickCradle Extinguisher Mount', 'MXG Demo Standard Parts', true, 'expendable', false, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_catalog_index":47,"demo_category":"Safety","demo_visual_key":"quickcradle-extinguisher-mount"}'::jsonb, now())
    ON CONFLICT (part_number, manufacturer) DO UPDATE SET
        description=EXCLUDED.description, classification=EXCLUDED.classification,
        is_serialized=EXCLUDED.is_serialized, metadata=EXCLUDED.metadata, updated_at=now();

    INSERT INTO part_requirements (
        id, organization_id, case_id, part_id, quantity, required_by,
        acceptable_conditions, status, priority, created_by
    ) VALUES
        ('d0000000-0000-4000-8000-000000000611', demo_org, 'd0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000738', 1, now() + interval '1 hour', '["NE","NS","OH"]'::jsonb, 'sourced', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000612', demo_org, 'd0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000701', 1, now() + interval '2 hours', '["NE","NS","OH","SV"]'::jsonb, 'sourced', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000613', demo_org, 'd0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000709', 1, now() + interval '2 hours', '["NE"]'::jsonb, 'sourced', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000614', demo_org, 'd0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000705', 1, now() + interval '2 hours', '["NE"]'::jsonb, 'sourced', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000615', demo_org, 'd0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000718', 2, now() + interval '2 hours', '["NE"]'::jsonb, 'sourced', 'aog', demo_actor),
        ('d0000000-0000-4000-8000-000000000616', demo_org, 'd0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000719', 4, now() + interval '2 hours', '["NE"]'::jsonb, 'sourced', 'aog', demo_actor)
    ON CONFLICT (id) DO UPDATE SET
        organization_id=EXCLUDED.organization_id, case_id=EXCLUDED.case_id,
        part_id=EXCLUDED.part_id, quantity=EXCLUDED.quantity,
        required_by=EXCLUDED.required_by, status=EXCLUDED.status,
        acceptable_conditions=EXCLUDED.acceptable_conditions,
        priority=EXCLUDED.priority, created_by=EXCLUDED.created_by;

    INSERT INTO suppliers (id, name, source_reference) VALUES
        ('d0000000-0000-4000-8000-000000000621', 'MXG Demo Parts Exchange', 'demo://supplier/parts-exchange'),
        ('d0000000-0000-4000-8000-000000000622', 'MXG Demo OEM Distribution', 'demo://supplier/oem')
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, source_reference=EXCLUDED.source_reference;

    INSERT INTO part_source_options (id, part_requirement_id, supplier_id, price, eta, condition, certificate_state, metadata) VALUES
        ('d0000000-0000-4000-8000-000000000631', 'd0000000-0000-4000-8000-000000000611', 'd0000000-0000-4000-8000-000000000621', 1450.00, now() + interval '45 minutes', 'OH', 'form_8130_available', '{"demo":true,"demo_suite":"friday_funding_demo"}'::jsonb),
        ('d0000000-0000-4000-8000-000000000632', 'd0000000-0000-4000-8000-000000000612', 'd0000000-0000-4000-8000-000000000622', 8200.00, now() + interval '90 minutes', 'OH', 'form_8130_available', '{"demo":true,"demo_suite":"friday_funding_demo"}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET
        part_requirement_id=EXCLUDED.part_requirement_id,
        supplier_id=EXCLUDED.supplier_id, price=EXCLUDED.price,
        eta=EXCLUDED.eta, condition=EXCLUDED.condition,
        certificate_state=EXCLUDED.certificate_state, metadata=EXCLUDED.metadata;

    INSERT INTO certificate_records (id, case_id, part_id, certificate_type, document_reference, validated) VALUES
        ('d0000000-0000-4000-8000-000000000641', 'd0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000701', 'FAA 8130-3', 'demo://certificate/8130/DEMO-MW-0117', true)
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        part_id=EXCLUDED.part_id, document_reference=EXCLUDED.document_reference,
        validated=EXCLUDED.validated;

    INSERT INTO inventory_locations (id, organization_id, code, name, location_type, barcode, metadata, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000651', demo_org, 'DEMO-MAIN-A1', '[DEMO] Main Stock A1', 'stock', 'MXG-DEMO-LOC-A1', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000652', demo_org, 'DEMO-QUAR', '[DEMO] Inspection Quarantine', 'quarantine', 'MXG-DEMO-LOC-Q', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now()),
        ('d0000000-0000-4000-8000-000000000653', demo_org, 'DEMO-SHIP', '[DEMO] Shipping Staging', 'shipping', 'MXG-DEMO-LOC-S', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now())
    ON CONFLICT (organization_id, code) DO UPDATE SET name=EXCLUDED.name, metadata=EXCLUDED.metadata, updated_at=now();

    INSERT INTO stock_units (
        id, organization_id, part_id, serial_number, lot_number, quantity,
        condition_code, status, trace_type, certificate_number, location_id,
        owner_type, received_at, created_by, metadata, version, updated_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000661', demo_org, 'd0000000-0000-4000-8000-000000000601', 'DEMO-PUMP-0042', NULL, 1, 'OH', 'available', 'form_8130', 'DEMO-8130-0042', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '12 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"tag_url":"https://mxgenius.io/parts/demo-pump-0042","ocr_fields":{"part_number":"MXG-DEMO-29-1001","serial_number":"DEMO-PUMP-0042","confidence":0.97}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000662', demo_org, 'd0000000-0000-4000-8000-000000000602', NULL, 'DEMO-FILTER-26A', 6, 'NE', 'available', 'coc', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '20 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"certificate_gap":true}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000663', demo_org, 'd0000000-0000-4000-8000-000000000603', NULL, 'DEMO-ORING-88', 24, 'NE', 'available', 'coc', 'DEMO-COC-0088', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000664', demo_org, 'd0000000-0000-4000-8000-000000000601', 'DEMO-PUMP-0099', NULL, 1, 'US', 'quarantine', 'none', NULL, 'd0000000-0000-4000-8000-000000000652', 'customer', now() - interval '1 day', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"reason":"awaiting trace review"}'::jsonb, 1, now())
    ON CONFLICT (organization_id, id) DO UPDATE SET
        quantity=EXCLUDED.quantity, condition_code=EXCLUDED.condition_code,
        status=EXCLUDED.status, trace_type=EXCLUDED.trace_type,
        certificate_number=EXCLUDED.certificate_number,
        location_id=EXCLUDED.location_id, metadata=EXCLUDED.metadata,
        version=EXCLUDED.version, updated_at=now();

    -- On-hand stock for the Challenger 350 wheel and brake scenario, so the
    -- headset can find and check out real inventory during the demo.
    INSERT INTO stock_units (
        id, organization_id, part_id, serial_number, lot_number, quantity,
        condition_code, status, trace_type, certificate_number, location_id,
        owner_type, received_at, created_by, metadata, version, updated_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000801', demo_org, 'd0000000-0000-4000-8000-000000000701', 'DEMO-MW-0117', NULL, 1, 'OH', 'available', 'form_8130', 'DEMO-8130-1117', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-MW-0117","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000802', demo_org, 'd0000000-0000-4000-8000-000000000703', 'DEMO-NW-0042', NULL, 1, 'SV', 'available', 'form_8130', 'DEMO-8130-1042', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-NW-0042","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000803', demo_org, 'd0000000-0000-4000-8000-000000000704', 'DEMO-BRK-0231', NULL, 1, 'OH', 'available', 'dual_release', 'DEMO-DR-2231', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-BRK-0231","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000804', demo_org, 'd0000000-0000-4000-8000-000000000706', 'DEMO-ROT-0455', NULL, 1, 'SV', 'available', 'ata106', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-ROT-0455","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000805', demo_org, 'd0000000-0000-4000-8000-000000000723', 'DEMO-TP-0088', NULL, 1, 'SV', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-TP-0088","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000806', demo_org, 'd0000000-0000-4000-8000-000000000726', 'DEMO-WST-0310', NULL, 1, 'NE', 'available', 'form_8130', 'DEMO-8130-3310', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-WST-0310","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000807', demo_org, 'd0000000-0000-4000-8000-000000000733', 'DEMO-GCU-0007', NULL, 1, 'OH', 'available', 'easa_form1', 'DEMO-EF1-0007', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-GCU-0007","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000808', demo_org, 'd0000000-0000-4000-8000-000000000736', 'DEMO-PITOT-0021', NULL, 1, 'NE', 'available', 'form_8130', 'DEMO-8130-0021', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"serial_number":"DEMO-PITOT-0021","confidence":0.96}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000809', demo_org, 'd0000000-0000-4000-8000-000000000738', 'DEMO-STB-0033', NULL, 1, 'OH', 'available', 'form_8130', 'DEMO-8130-5033', 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '14 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_suite":"friday_funding_demo","ocr_fields":{"serial_number":"DEMO-STB-0033","confidence":0.97}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000821', demo_org, 'd0000000-0000-4000-8000-000000000705', NULL, 'LOT-BL-7741', 4, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BL-7741","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000822', demo_org, 'd0000000-0000-4000-8000-000000000709', NULL, 'LOT-TIRE-2210', 3, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-TIRE-2210","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000823', demo_org, 'd0000000-0000-4000-8000-000000000710', NULL, 'LOT-TIRE-2211', 2, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-TIRE-2211","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000824', demo_org, 'd0000000-0000-4000-8000-000000000711', NULL, 'LOT-BRG-5510', 8, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BRG-5510","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000825', demo_org, 'd0000000-0000-4000-8000-000000000712', NULL, 'LOT-BRG-5511', 8, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BRG-5511","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000826', demo_org, 'd0000000-0000-4000-8000-000000000714', NULL, 'LOT-SEAL-9902', 24, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-SEAL-9902","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000827', demo_org, 'd0000000-0000-4000-8000-000000000715', NULL, 'LOT-BOLT-3301', 40, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-BOLT-3301","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000828', demo_org, 'd0000000-0000-4000-8000-000000000716', NULL, 'LOT-NUT-3302', 40, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-NUT-3302","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000829', demo_org, 'd0000000-0000-4000-8000-000000000718', NULL, 'LOT-PIN-4400', 100, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-PIN-4400","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000830', demo_org, 'd0000000-0000-4000-8000-000000000719', NULL, 'LOT-FUSE-6620', 12, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-FUSE-6620","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000831', demo_org, 'd0000000-0000-4000-8000-000000000720', NULL, 'LOT-VLV-7730', 16, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-VLV-7730","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000832', demo_org, 'd0000000-0000-4000-8000-000000000721', NULL, 'LOT-VLC-7731', 30, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-VLC-7731","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000833', demo_org, 'd0000000-0000-4000-8000-000000000731', NULL, 'LOT-HYDF-8810', 6, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-HYDF-8810","confidence":0.93}}'::jsonb, 1, now()),
        ('d0000000-0000-4000-8000-000000000834', demo_org, 'd0000000-0000-4000-8000-000000000737', NULL, 'LOT-OILF-9910', 10, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"ocr_fields":{"lot_number":"LOT-OILF-9910","confidence":0.93}}'::jsonb, 1, now())
    ON CONFLICT (id) DO UPDATE SET
        quantity=EXCLUDED.quantity, condition_code=EXCLUDED.condition_code,
        status=EXCLUDED.status, trace_type=EXCLUDED.trace_type,
        metadata=EXCLUDED.metadata, updated_at=now();

    -- One stock unit per expanded catalog entry produces exactly 47 additional
    -- inventory cards. Serialized demo components remain quantity one; bulk
    -- hardware carries its synthetic on-hand count in the unit quantity.
    INSERT INTO stock_units (
        id, organization_id, part_id, serial_number, lot_number, quantity,
        condition_code, status, trace_type, certificate_number, location_id,
        owner_type, received_at, created_by, metadata, version, updated_at
    ) VALUES
        ('d2000000-0000-4000-8000-000000000001', demo_org, 'd1000000-0000-4000-8000-000000000001', 'DEMO-LGT-1101-01', NULL, 1, 'NE', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '1 day', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"aurora-wingtip-nav-module","demo_category":"Lighting","display_condition":"New","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000002', demo_org, 'd1000000-0000-4000-8000-000000000002', 'DEMO-LGT-1102-01', NULL, 1, 'SV', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '2 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"runway-caster-taxi-lamp","demo_category":"Lighting","display_condition":"Serviceable","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000003', demo_org, 'd1000000-0000-4000-8000-000000000003', 'DEMO-LGT-1103-01', NULL, 1, 'OH', 'available', 'dual_release', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '3 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"pulsecrest-beacon-head","demo_category":"Lighting","display_condition":"Overhauled","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000004', demo_org, 'd1000000-0000-4000-8000-000000000004', NULL, 'DEMO-LGT-1104-A', 12, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '4 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"lumarail-cabin-strip-kit","demo_category":"Lighting","display_condition":"New","reorder_threshold":4}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000005', demo_org, 'd1000000-0000-4000-8000-000000000005', 'DEMO-WBR-2101-01', NULL, 1, 'OH', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '5 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"aeroarc-nose-wheel-assembly","demo_category":"Wheels & Brakes","display_condition":"Overhauled","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000006', demo_org, 'd1000000-0000-4000-8000-000000000006', 'DEMO-WBR-2102-01', NULL, 1, 'SV', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '6 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"vectortorque-main-wheel","demo_category":"Wheels & Brakes","display_condition":"Serviceable","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000007', demo_org, 'd1000000-0000-4000-8000-000000000007', 'DEMO-WBR-2103-01', NULL, 1, 'NE', 'available', 'dual_release', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '7 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"heatweave-brake-rotor","demo_category":"Wheels & Brakes","display_condition":"New","reorder_threshold":4}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000008', demo_org, 'd1000000-0000-4000-8000-000000000008', 'DEMO-WBR-2104-01', NULL, 1, 'OH', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '8 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"clampforce-brake-caliper","demo_category":"Wheels & Brakes","display_condition":"Overhauled","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000009', demo_org, 'd1000000-0000-4000-8000-000000000009', NULL, 'DEMO-WBR-2105-A', 24, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '9 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"wearcheck-indicator-pin-set","demo_category":"Wheels & Brakes","display_condition":"New","reorder_threshold":8}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000010', demo_org, 'd1000000-0000-4000-8000-000000000010', NULL, 'DEMO-TIR-3101-A', 6, 'SV', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '10 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"glidepath-nose-tire","demo_category":"Tires","display_condition":"Serviceable","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000011', demo_org, 'd1000000-0000-4000-8000-000000000011', NULL, 'DEMO-TIR-3102-A', 8, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '11 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"rampstride-main-tire","demo_category":"Tires","display_condition":"New","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000012', demo_org, 'd1000000-0000-4000-8000-000000000012', NULL, 'DEMO-TIR-3103-A', 4, 'US', 'quarantine', 'none', NULL, 'd0000000-0000-4000-8000-000000000652', 'owned', now() - interval '12 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"fieldflex-low-pressure-tire","demo_category":"Tires","display_condition":"Inspection Due","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000013', demo_org, 'd1000000-0000-4000-8000-000000000013', 'DEMO-ELE-4101-01', NULL, 1, 'SV', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '13 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"startlink-power-contactor","demo_category":"Electrical","display_condition":"Serviceable","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000014', demo_org, 'd1000000-0000-4000-8000-000000000014', NULL, 'DEMO-ELE-4102-A', 32, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '14 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"arcguard-breaker-10a","demo_category":"Electrical","display_condition":"New","reorder_threshold":10}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000015', demo_org, 'd1000000-0000-4000-8000-000000000015', NULL, 'DEMO-ELE-4103-A', 4, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '15 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"powerdock-battery-tray","demo_category":"Electrical","display_condition":"New","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000016', demo_org, 'd1000000-0000-4000-8000-000000000016', NULL, 'DEMO-ELE-4104-A', 18, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '16 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"bondweave-ground-strap","demo_category":"Electrical","display_condition":"New","reorder_threshold":6}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000017', demo_org, 'd1000000-0000-4000-8000-000000000017', 'DEMO-AVN-5101-01', NULL, 1, 'SV', 'available', 'easa_form1', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '17 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"navcore-comm-control-panel","demo_category":"Avionics","display_condition":"Serviceable","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000018', demo_org, 'd1000000-0000-4000-8000-000000000018', 'DEMO-AVN-5102-01', NULL, 1, 'US', 'quarantine', 'none', NULL, 'd0000000-0000-4000-8000-000000000652', 'owned', now() - interval '18 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"horizonview-display-unit","demo_category":"Avionics","display_condition":"Display Sample","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000019', demo_org, 'd1000000-0000-4000-8000-000000000019', 'DEMO-AVN-5103-01', NULL, 1, 'OH', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '19 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"squawklink-transponder-panel","demo_category":"Avionics","display_condition":"Overhauled","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000020', demo_org, 'd1000000-0000-4000-8000-000000000020', 'DEMO-AVN-5104-01', NULL, 1, 'NE', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '20 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"flightdata-interface-unit","demo_category":"Avionics","display_condition":"New","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000021', demo_org, 'd1000000-0000-4000-8000-000000000021', 'DEMO-AVN-5105-01', NULL, 1, 'SV', 'available', 'dual_release', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '21 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"crewlink-audio-controller","demo_category":"Avionics","display_condition":"Serviceable","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000022', demo_org, 'd1000000-0000-4000-8000-000000000022', NULL, 'DEMO-FIL-6101-A', 15, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '22 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"airshield-intake-filter","demo_category":"Filters","display_condition":"New","reorder_threshold":5}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000023', demo_org, 'd1000000-0000-4000-8000-000000000023', NULL, 'DEMO-FIL-6102-A', 11, 'SV', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '23 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"hydrapure-return-filter","demo_category":"Filters","display_condition":"Serviceable","reorder_threshold":4}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000024', demo_org, 'd1000000-0000-4000-8000-000000000024', NULL, 'DEMO-FIL-6103-A', 20, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '24 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"cabinmesh-air-filter","demo_category":"Filters","display_condition":"New","reorder_threshold":6}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000025', demo_org, 'd1000000-0000-4000-8000-000000000025', 'DEMO-HYD-7101-01', NULL, 1, 'OH', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '25 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"pressuridge-hydraulic-pump","demo_category":"Hydraulics","display_condition":"Overhauled","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000026', demo_org, 'd1000000-0000-4000-8000-000000000026', NULL, 'DEMO-HYD-7102-A', 9, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '26 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"flexflow-hose-assembly","demo_category":"Hydraulics","display_condition":"New","reorder_threshold":3}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000027', demo_org, 'd1000000-0000-4000-8000-000000000027', 'DEMO-HYD-7103-01', NULL, 1, 'SV', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '27 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"fluidnest-reservoir","demo_category":"Hydraulics","display_condition":"Serviceable","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000028', demo_org, 'd1000000-0000-4000-8000-000000000028', 'DEMO-HYD-7104-01', NULL, 1, 'NE', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '28 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"reliefpoint-pressure-valve","demo_category":"Hydraulics","display_condition":"New","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000029', demo_org, 'd1000000-0000-4000-8000-000000000029', 'DEMO-FCT-8101-01', NULL, 1, 'SV', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '29 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"trimdrive-tab-actuator","demo_category":"Flight Controls","display_condition":"Serviceable","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000030', demo_org, 'd1000000-0000-4000-8000-000000000030', NULL, 'DEMO-FCT-8102-A', 6, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '30 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"rollpivot-aileron-bellcrank","demo_category":"Flight Controls","display_condition":"New","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000031', demo_org, 'd1000000-0000-4000-8000-000000000031', NULL, 'DEMO-FCT-8103-A', 8, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '31 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"rudderline-cable-kit","demo_category":"Flight Controls","display_condition":"New","reorder_threshold":3}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000032', demo_org, 'd1000000-0000-4000-8000-000000000032', 'DEMO-FCT-8104-01', NULL, 1, 'OH', 'available', 'dual_release', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '32 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"flaptrack-drive-gearbox","demo_category":"Flight Controls","display_condition":"Overhauled","reorder_threshold":1}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000033', demo_org, 'd1000000-0000-4000-8000-000000000033', NULL, 'DEMO-CAB-9101-A', 20, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '33 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"seatrail-locking-fitting","demo_category":"Cabin","display_condition":"New","reorder_threshold":8}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000034', demo_org, 'd1000000-0000-4000-8000-000000000034', NULL, 'DEMO-CAB-9102-A', 14, 'SV', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '34 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"swivelair-vent-outlet","demo_category":"Cabin","display_condition":"Serviceable","reorder_threshold":5}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000035', demo_org, 'd1000000-0000-4000-8000-000000000035', NULL, 'DEMO-CAB-9103-A', 16, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '35 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"binhold-latch-assembly","demo_category":"Cabin","display_condition":"New","reorder_threshold":6}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000036', demo_org, 'd1000000-0000-4000-8000-000000000036', NULL, 'DEMO-CAB-9104-A', 9, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '36 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"doorsoft-pressure-seal","demo_category":"Cabin","display_condition":"New","reorder_threshold":3}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000037', demo_org, 'd1000000-0000-4000-8000-000000000037', 'DEMO-SNS-1011-01', NULL, 1, 'NE', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '37 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"thermospire-temperature-probe","demo_category":"Sensors","display_condition":"New","reorder_threshold":4}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000038', demo_org, 'd1000000-0000-4000-8000-000000000038', 'DEMO-SNS-1012-01', NULL, 1, 'US', 'quarantine', 'none', NULL, 'd0000000-0000-4000-8000-000000000652', 'owned', now() - interval '38 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"airstream-pitot-static-probe","demo_category":"Sensors","display_condition":"Inspection Due","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000039', demo_org, 'd1000000-0000-4000-8000-000000000039', 'DEMO-SNS-1013-01', NULL, 1, 'SV', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '39 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"fuellevel-capacitive-sender","demo_category":"Sensors","display_condition":"Serviceable","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000040', demo_org, 'd1000000-0000-4000-8000-000000000040', 'DEMO-SNS-1014-01', NULL, 1, 'NE', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '40 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"gearnear-proximity-sensor","demo_category":"Sensors","display_condition":"New","reorder_threshold":3}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000041', demo_org, 'd1000000-0000-4000-8000-000000000041', NULL, 'DEMO-CON-1111-A', 22, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '41 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"lockwire-stainless-spool","demo_category":"Fasteners & Consumables","display_condition":"New","reorder_threshold":8}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000042', demo_org, 'd1000000-0000-4000-8000-000000000042', NULL, 'DEMO-CON-1112-A', 40, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '42 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"flushset-rivet-assortment","demo_category":"Fasteners & Consumables","display_condition":"New","reorder_threshold":15}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000043', demo_org, 'd1000000-0000-4000-8000-000000000043', NULL, 'DEMO-CON-1113-A', 28, 'NE', 'available', 'coc_vendor', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '43 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"cushionclamp-line-kit","demo_category":"Fasteners & Consumables","display_condition":"New","reorder_threshold":10}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000044', demo_org, 'd1000000-0000-4000-8000-000000000044', NULL, 'DEMO-CON-1114-A', 36, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '44 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"sealpack-o-ring-assortment","demo_category":"Fasteners & Consumables","display_condition":"New","reorder_threshold":12}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000045', demo_org, 'd1000000-0000-4000-8000-000000000045', NULL, 'DEMO-SAF-1211-A', 18, 'NE', 'available', 'coc_mfr', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '45 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"evacglow-exit-path-marker","demo_category":"Safety","display_condition":"New","reorder_threshold":6}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000046', demo_org, 'd1000000-0000-4000-8000-000000000046', 'DEMO-SAF-1212-01', NULL, 1, 'SV', 'available', 'form_8130', NULL, 'd0000000-0000-4000-8000-000000000651', 'owned', now() - interval '46 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"crewsecure-four-point-restraint","demo_category":"Safety","display_condition":"Serviceable","reorder_threshold":2}'::jsonb, 1, now()),
        ('d2000000-0000-4000-8000-000000000047', demo_org, 'd1000000-0000-4000-8000-000000000047', NULL, 'DEMO-SAF-1213-A', 8, 'US', 'quarantine', 'none', NULL, 'd0000000-0000-4000-8000-000000000652', 'owned', now() - interval '47 days', demo_actor, '{"dataset":"mxgenius_complete_demo","demo":true,"demo_collection":"expanded_parts_47","demo_visual_key":"quickcradle-extinguisher-mount","demo_category":"Safety","display_condition":"Display Sample","reorder_threshold":3}'::jsonb, 1, now())
    ON CONFLICT (id) DO UPDATE SET
        quantity=EXCLUDED.quantity, condition_code=EXCLUDED.condition_code,
        status=EXCLUDED.status, trace_type=EXCLUDED.trace_type,
        location_id=EXCLUDED.location_id, metadata=EXCLUDED.metadata,
        version=EXCLUDED.version, updated_at=now();


    INSERT INTO receiving_drafts (
        id, organization_id, part_id, status, proposed_fields, created_by,
        expires_at, updated_at, version
    ) VALUES (
        'd0000000-0000-4000-8000-000000000671', demo_org,
        'd0000000-0000-4000-8000-000000000601', 'ready',
        '{"dataset":"mxgenius_complete_demo","demo":true,"part_number":"MXG-DEMO-29-1001","serial_number":"DEMO-PUMP-0100","condition_code":"OH","trace_type":"form_8130","location":"DEMO-QUAR"}'::jsonb,
        demo_actor, now() + interval '7 days', now(), 1
    ) ON CONFLICT (organization_id, id) DO UPDATE SET
        status=EXCLUDED.status, proposed_fields=EXCLUDED.proposed_fields,
        expires_at=EXCLUDED.expires_at, updated_at=now();

    INSERT INTO inventory_events (
        id, organization_id, stock_unit_id, event_type, quantity_delta,
        to_location_id, reference_type, reference_id, actor_user_id,
        correlation_id, notes, payload, created_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000681', demo_org, 'd0000000-0000-4000-8000-000000000661', 'receive', 1, 'd0000000-0000-4000-8000-000000000652', 'demo_receipt', 'DEMO-PO-1001', demo_actor, 'd0000000-0000-4000-8000-000000000689', '[DEMO] Pump received into quarantine.', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now() - interval '12 days'),
        ('d0000000-0000-4000-8000-000000000682', demo_org, 'd0000000-0000-4000-8000-000000000661', 'inspect_pass', 0, 'd0000000-0000-4000-8000-000000000651', 'demo_inspection', 'DEMO-INSP-1001', demo_actor, 'd0000000-0000-4000-8000-000000000688', '[DEMO] Trace and condition inspection passed.', '{"dataset":"mxgenius_complete_demo","demo":true}'::jsonb, now() - interval '11 days')
    ON CONFLICT (organization_id, id) DO NOTHING;

    INSERT INTO faa_candidate_queries (
        id, organization_id, stock_unit_id, state, source_name, source_url,
        normalized_identifiers, candidates, retrieved_at, correlation_id
    ) VALUES (
        'd0000000-0000-4000-8000-000000000691', demo_org,
        'd0000000-0000-4000-8000-000000000661', 'candidates_found',
        'FAA DRS demonstration result', 'https://drs.faa.gov/browse/AD',
        '{"part_number":"MXG-DEMO-29-1001","manufacturer":"MXG Demo Components","demo":true}'::jsonb,
        '[{"reference":"DEMO-AD-2026-01","title":"DEMO ONLY — fictional hydraulic pump inspection","candidate_only":true}]'::jsonb,
        now(), 'd0000000-0000-4000-8000-000000000699'
    ) ON CONFLICT (organization_id, id) DO UPDATE SET
        state=EXCLUDED.state, candidates=EXCLUDED.candidates, retrieved_at=now();

    INSERT INTO schedule_options (id, case_id, start_at, end_at, notes) VALUES
        ('d0000000-0000-4000-8000-000000000721', 'd0000000-0000-4000-8000-000000000101', now() + interval '30 minutes', now() + interval '90 minutes', '[DEMO] Fast strobe replacement and operational check.'),
        ('d0000000-0000-4000-8000-000000000722', 'd0000000-0000-4000-8000-000000000102', now() + interval '2 hours', now() + interval '8 hours', '[DEMO] Main wheel, tire, and brake replacement after parts release.'),
        ('d0000000-0000-4000-8000-000000000723', 'd0000000-0000-4000-8000-000000000103', now() + interval '20 minutes', now() + interval '50 minutes', '[DEMO] Remote windshield damage-limit review window.')
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        start_at=EXCLUDED.start_at, end_at=EXCLUDED.end_at, notes=EXCLUDED.notes;

    INSERT INTO recommendations (id, case_id, body) VALUES
        ('d0000000-0000-4000-8000-000000000731', 'd0000000-0000-4000-8000-000000000101', '{"dataset":"mxgenius_complete_demo","demo":true,"recommendation":"Use the matched on-hand strobe assembly, follow current approved removal and installation data, then perform the lighting operational check.","advisory_only":true}'::jsonb),
        ('d0000000-0000-4000-8000-000000000732', 'd0000000-0000-4000-8000-000000000102', '{"dataset":"mxgenius_complete_demo","demo":true,"recommendation":"Release the traced wheel, tire, brake lining, cotter pins, and thermal plugs after quality review; retrieve current approved torque and procedure data before work.","advisory_only":true}'::jsonb),
        ('d0000000-0000-4000-8000-000000000733', 'd0000000-0000-4000-8000-000000000103', '{"dataset":"mxgenius_complete_demo","demo":true,"recommendation":"Start remote witness, show the damage and surrounding windshield area, and record the qualified reviewer disposition against current approved limits.","advisory_only":true}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id, body=EXCLUDED.body;

    INSERT INTO digital_twin_markers (
        id, organization_id, case_id, component_id, zone_id, severity,
        observation_id, created_by, created_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000801', demo_org, 'd0000000-0000-4000-8000-000000000101', 'MXG-DEMO-STROBE-LH', 'left_wingtip', 'medium', 'd0000000-0000-4000-8000-000000000221', demo_actor, now() - interval '25 minutes'),
        ('d0000000-0000-4000-8000-000000000802', demo_org, 'd0000000-0000-4000-8000-000000000102', 'MXG-DEMO-MAIN-WHEEL-RH', 'right_main_landing_gear', 'high', 'd0000000-0000-4000-8000-000000000222', demo_actor, now() - interval '2 hours'),
        ('d0000000-0000-4000-8000-000000000803', demo_org, 'd0000000-0000-4000-8000-000000000103', 'MXG-DEMO-WINDSHIELD-LH', 'cockpit_left_windshield', 'high', 'd0000000-0000-4000-8000-000000000223', demo_actor, now() - interval '40 minutes')
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        component_id=EXCLUDED.component_id, zone_id=EXCLUDED.zone_id,
        severity=EXCLUDED.severity, observation_id=EXCLUDED.observation_id;

    INSERT INTO audit_events (
        id, case_id, actor_user_id, organization_id, action, payload,
        correlation_id, created_at
    ) VALUES
        ('d0000000-0000-4000-8000-000000000901', 'd0000000-0000-4000-8000-000000000101', demo_actor, demo_org, 'demo.strobe.case_ready', '{"dataset":"mxgenius_complete_demo","demo":true,"demo_sequence":1}'::jsonb, 'd0000000-0000-4000-8000-000000000909', now() - interval '20 minutes'),
        ('d0000000-0000-4000-8000-000000000902', 'd0000000-0000-4000-8000-000000000102', demo_actor, demo_org, 'demo.wheel.parts_ready', '{"dataset":"mxgenius_complete_demo","demo":true,"demo_sequence":2}'::jsonb, 'd0000000-0000-4000-8000-000000000908', now() - interval '90 minutes'),
        ('d0000000-0000-4000-8000-000000000903', 'd0000000-0000-4000-8000-000000000103', demo_actor, demo_org, 'demo.windshield.remote_review_ready', '{"dataset":"mxgenius_complete_demo","demo":true,"demo_sequence":3}'::jsonb, 'd0000000-0000-4000-8000-000000000907', now() - interval '35 minutes')
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        action=EXCLUDED.action, payload=EXCLUDED.payload;
END $$;

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
        ('d0000000-0000-4000-8000-000000000212', demo_org, 'd0000000-0000-4000-8000-000000000102', 'diagnosing', 'awaiting_parts', demo_actor, '[DEMO] Wheel, tire, brake, and hardware requirements recorded for follow-up.', now() - interval '2 hours'),
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
        ('d0000000-0000-4000-8000-000000000403', demo_org, '[DEMO] Challenger 350 Windshield Damage Review Card', 'maintenance_manual')
    ON CONFLICT (organization_id, id) DO UPDATE SET title=EXCLUDED.title, doc_type=EXCLUDED.doc_type;

    INSERT INTO document_revisions (id, document_id, revision, effective_date, uploaded_by, sha256) VALUES
        ('d0000000-0000-4000-8000-000000000411', 'd0000000-0000-4000-8000-000000000401', 'DEMO-1', current_date - 30, demo_actor, repeat('a',64)),
        ('d0000000-0000-4000-8000-000000000412', 'd0000000-0000-4000-8000-000000000402', 'DEMO-2', current_date - 30, demo_actor, repeat('b',64)),
        ('d0000000-0000-4000-8000-000000000413', 'd0000000-0000-4000-8000-000000000403', 'DEMO-1', current_date - 30, demo_actor, repeat('c',64))
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
        ('d0000000-0000-4000-8000-000000000503', demo_org, 'demo', 'demo://manual/wheel/32', 'manual_excerpt', '[DEMO] Main Wheel and Brake Work Card', 'Demonstration flow connects the wheel case to trace records and approved-manual retrieval for removal, installation, torque, and inspection steps.', now() - interval '90 minutes', now() - interval '30 days', 'DEMO-1', 'fictional-demo-only', repeat('3',64), 'Fictional demonstration content. No torque value in this record is approved maintenance data.'),
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
        ('d0000000-0000-4000-8000-000000000521', demo_org, 'd0000000-0000-4000-8000-000000000103', 'windshield_damage_limit_review', 'quality', NULL, NULL, NULL)
    ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id,
        action=EXCLUDED.action, required_role=EXCLUDED.required_role,
        granted_by=EXCLUDED.granted_by, granted_at=EXCLUDED.granted_at,
        decision=EXCLUDED.decision;

    INSERT INTO schedule_options (id, case_id, start_at, end_at, notes) VALUES
        ('d0000000-0000-4000-8000-000000000721', 'd0000000-0000-4000-8000-000000000101', now() + interval '30 minutes', now() + interval '90 minutes', '[DEMO] Fast strobe replacement and operational check.'),
        ('d0000000-0000-4000-8000-000000000722', 'd0000000-0000-4000-8000-000000000102', now() + interval '2 hours', now() + interval '8 hours', '[DEMO] Main wheel, tire, and brake replacement after material readiness review.'),
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
